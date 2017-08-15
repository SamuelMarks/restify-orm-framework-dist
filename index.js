"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const Logger = require("bunyan");
const restify = require("restify");
const Redis = require("ioredis");
const sequelize = require("sequelize");
const typeorm = require("typeorm");
const Waterline = require("waterline");
const path_1 = require("path");
const async_1 = require("async");
const restify_plugins_1 = require("restify-plugins");
const custom_restify_errors_1 = require("custom-restify-errors");
const nodejs_utils_1 = require("nodejs-utils");
const populateModels = (program, omit_models, norm_set, waterline_set, typeorm_map, sequelize_map) => Object
    .keys(program)
    .filter(entity => program[entity] != null && omit_models.indexOf(entity) === -1)
    .forEach(entity => {
    if (program[entity].identity || program[entity].tableName)
        waterline_set.add(program[entity]);
    else if (typeof program[entity] === 'function')
        if (program[entity].toString().indexOf('sequelize') > -1)
            sequelize_map.set(entity, program[entity]);
        else if (program[entity].toString().indexOf('class') > -1)
            typeorm_map.set(entity, program[entity]);
        else
            norm_set.add(entity);
    else
        norm_set.add(entity);
});
const handleStartApp = (skip_start_app, app, listen_port, onServerStart, logger, orms_out, callback) => skip_start_app ? callback != null && callback(null, app, orms_out)
    : app.listen(listen_port, () => {
        logger.info('%s listening at %s', app.name, app.url);
        if (onServerStart != null)
            return onServerStart(app.url, app, orms_out, callback == null ? () => { } : callback);
        else if (callback != null)
            return callback(null, app, orms_out);
    });
const redisHandler = (orm, logger, callback) => {
    if (orm.skip)
        return callback(void 0);
    const cursor = new Redis(orm.config);
    cursor.on('error', err => {
        logger.error(`Redis::error event - ${cursor['options']['host']}:${cursor['options']['port']} - ${err}`);
        logger.error(err);
        return callback(err);
    });
    cursor.on('connect', () => {
        logger.info(`Redis client connected to:\t ${cursor['options']['host']}:${cursor['options']['port']}`);
        return callback(void 0, { connection: cursor });
    });
};
const sequelizeHandler = (orm, logger, callback) => {
    if (orm.skip)
        return callback(void 0);
    logger.info('Sequelize initialising with:\t', Array.from(orm.map.keys()), ';');
    const sequelize_obj = new sequelize['Sequelize'](orm.uri, orm.config);
    const entities = new Map();
    for (const [entity, program] of orm.map)
        entities.set(entity, program(sequelize_obj));
    sequelize_obj
        .authenticate()
        .then(() => async_1.map(Array.from(entities.keys()), (entity_name, cb) => sequelize_obj
        .sync(entities.get(entity_name))
        .then(_ => cb(void 0))
        .catch(cb), err => callback(err, { connection: sequelize_obj, entities })))
        .catch(callback);
};
const typeormHandler = (orm, logger, callback) => {
    if (orm.skip)
        return callback(void 0);
    logger.info('TypeORM initialising with:\t', Array.from(orm.map.keys()), ';');
    try {
        return typeorm.createConnection(Object.assign({
            entities: Array.from(orm.map.values())
        }, orm.config)).then(connection => callback(null, { connection })).catch(callback);
    }
    catch (e) {
        return callback(e);
    }
};
const waterlineHandler = (orm, logger, callback) => {
    if (orm.skip)
        return callback(void 0);
    const waterline_obj = new Waterline();
    Array
        .from(orm.set.values())
        .forEach(e => waterline_obj.loadCollection(Waterline.Collection.extend(e)));
    waterline_obj.initialize(orm.config, (err, ontology) => {
        if (err != null)
            return callback(err);
        else if (ontology == null || ontology.connections == null || ontology.collections == null
            || ontology.connections.length === 0 || ontology.collections.length === 0) {
            logger.error('waterline_obj.initialize::ontology =', ontology, ';');
            return callback(new TypeError('Expected ontology with connections & waterline_collections'));
        }
        logger.info('Waterline initialised with:\t', Object.keys(ontology.collections), ';');
        return callback(null, { connection: ontology.connections, collections: ontology.collections });
    });
};
exports.tearDownRedisConnection = (connection, done) => connection == null ? done(void 0) : done(connection.disconnect());
exports.tearDownSequelizeConnection = (connection, done) => connection == null ? done(void 0) : done(connection.close());
exports.tearDownTypeOrmConnection = (connection, done) => connection == null || !connection.isConnected ? done(void 0) : connection.close().then(_ => done()).catch(done);
exports.tearDownWaterlineConnection = (connections, done) => connections ? async_1.parallel(Object.keys(connections).map(connection => connections[connection]._adapter.teardown), () => {
    Object.keys(connections).forEach(connection => {
        if (['sails-tingo', 'waterline-nedb'].indexOf(connections[connection]._adapter.identity) < 0)
            connections[connection]._adapter.connections.delete(connection);
    });
    return done();
}) : done();
exports.tearDownConnections = (orms, done) => async_1.parallel({
    redis: cb => exports.tearDownRedisConnection((orms.redis || { connection: undefined }).connection, cb),
    sequelize: cb => exports.tearDownSequelizeConnection((orms.sequelize || { connection: undefined }).connection, cb),
    typeorm: cb => exports.tearDownTypeOrmConnection((orms.typeorm || { connection: undefined }).connection, cb),
    waterline: cb => exports.tearDownWaterlineConnection((orms.waterline || { connection: undefined }).connection, cb)
}, done);
exports.strapFramework = (kwargs) => {
    if (kwargs.root == null)
        kwargs.root = '/api';
    if (kwargs.skip_app_logging == null)
        kwargs.skip_app_logging = true;
    if (kwargs.skip_app_version_routes == null)
        kwargs.skip_app_version_routes = true;
    if (kwargs.skip_start_app == null)
        kwargs.skip_start_app = false;
    else if (kwargs.listen_port == null)
        kwargs.listen_port = typeof process.env['PORT'] === 'undefined' ? 3000 : ~~process.env['PORT'];
    Object.keys(kwargs.orms_in).map(orm => {
        if (kwargs.orms_in[orm].skip == null)
            kwargs.orms_in[orm].skip = true;
    });
    if (kwargs.orms_in.redis != null && !kwargs.orms_in.redis.skip && kwargs.orms_in.redis.config == null)
        kwargs.orms_in.redis.config = process.env['REDIS_URL'] == null ? { port: 6379 } : process.env['REDIS_URL'];
    const app = restify.createServer(Object.assign({ name: kwargs.app_name }, kwargs.createServerArgs || {}));
    app.use(restify_plugins_1.queryParser());
    app.use(restify_plugins_1.bodyParser());
    app.on('WLError', (req, res, err, next) => next(new custom_restify_errors_1.WaterlineError(err)));
    if (!kwargs.skip_app_logging)
        app.on('after', restify_plugins_1.auditLogger({
            log: Logger.createLogger({
                name: 'audit',
                stream: process.stdout
            })
        }));
    if (!kwargs.skip_app_version_routes)
        ['/', '/version', '/api', '/api/version'].map(route_path => app.get(route_path, (req, res, next) => {
            res.json({ version: kwargs.package_.version });
            return next();
        }));
    const routes = new Set();
    const norm = new Set();
    const waterline_set = new Set();
    const typeorm_map = new Map();
    const sequelize_map = new Map();
    const do_models = Object
        .keys(kwargs.orms_in)
        .filter(orm => orm !== 'Redis')
        .some(orm => kwargs.orms_in[orm].skip === false);
    if (!(kwargs.models_and_routes instanceof Map))
        kwargs.models_and_routes = nodejs_utils_1.model_route_to_map(kwargs.models_and_routes);
    for (const [fname, program] of kwargs.models_and_routes)
        if (program != null)
            if (fname.indexOf('model') > -1 && do_models)
                populateModels(program, kwargs.omit_models || ['AccessToken'], norm, waterline_set, typeorm_map, sequelize_map);
            else
                typeof program === 'object' && Object.keys(program).map((route) => program[route](app, `${kwargs.root}/${path_1.dirname(fname)}`)) && routes.add(path_1.dirname(fname));
    kwargs.logger.info('Restify registered routes:\t', Array.from(routes.keys()), ';');
    kwargs.logger.warn('Failed registering models:\t', Array.from(norm.keys()), ';');
    async_1.parallel({
        redis: cb => kwargs.orms_in.redis == null ? cb(void 0) :
            redisHandler(kwargs.orms_in.redis, kwargs.logger, cb),
        sequelize: cb => kwargs.orms_in.sequelize == null ? cb(void 0) :
            sequelizeHandler(Object.assign(kwargs.orms_in.sequelize, { map: sequelize_map }), kwargs.logger, cb),
        typeorm: cb => kwargs.orms_in.typeorm == null ? cb(void 0) :
            typeormHandler(Object.assign(kwargs.orms_in.typeorm, { map: typeorm_map }), kwargs.logger, cb),
        waterline: cb => kwargs.orms_in.waterline == null ? cb(void 0) :
            waterlineHandler(Object.assign(kwargs.orms_in.waterline, { set: waterline_set }), kwargs.logger, cb),
    }, (err, orms_out) => {
        if (err != null) {
            if (kwargs.callback)
                return kwargs.callback(err);
            throw err;
        }
        return handleStartApp(kwargs.skip_start_app, app, kwargs.listen_port, kwargs.onServerStart, kwargs.logger, orms_out, kwargs.callback);
    });
};
exports.add_to_body_mw = (...updates) => (req, res, next) => {
    req.body && updates.map(pair => req.body[pair[0]] = updates[pair[1]]);
    return next();
};
