"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const async_1 = require("async");
const restify = require("restify");
const restify_plugins_1 = require("restify-plugins");
const Waterline = require("waterline");
const waterline_1 = require("waterline");
const bunyan_1 = require("bunyan");
const custom_restify_errors_1 = require("custom-restify-errors");
const Redis = require("ioredis");
const nodejs_utils_1 = require("nodejs-utils");
const sequelize = require("sequelize");
const typeorm_1 = require("typeorm");
require("reflect-metadata");
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
const handleStartApp = (kwargs, app, waterline_connections, waterline_collections, typeorm_connection, sequelize_connection) => {
    const orms_out = Object.freeze({
        sequelize: {
            connection: sequelize_connection
        },
        typeorm: {
            connection: typeorm_connection
        },
        waterline: {
            connection: waterline_connections,
            collections: kwargs.waterline_collections
        }
    });
    return kwargs.skip_start_app ? kwargs.callback != null && kwargs.callback(null, app, orms_out)
        : app.listen(kwargs.listen_port, () => {
            kwargs.logger.info('%s listening at %s', app.name, app.url);
            if (kwargs.onServerStart != null)
                return kwargs.onServerStart(app.url, app, orms_out, kwargs.callback == null ? () => { } : kwargs.callback);
            else if (kwargs.callback != null)
                return kwargs.callback(null, app, orms_out);
        });
};
const waterlineHandler = (kwargs, app, waterline_set, callback) => {
    if (kwargs.skip_waterline)
        return callback(void 0);
    const waterline_obj = new Waterline();
    Array.from(waterline_set.values()).forEach(e => waterline_obj.loadCollection(waterline_1.Collection.extend(e)));
    waterline_obj.initialize(kwargs.waterline_config, (err, ontology) => {
        if (err != null)
            return callback(err);
        else if (ontology == null || ontology.connections == null || ontology.collections == null
            || ontology.connections.length === 0 || ontology.collections.length === 0) {
            kwargs.logger.error('waterline_obj.initialize::ontology =', ontology, ';');
            return callback(new TypeError('Expected ontology with connections & waterline_collections'));
        }
        kwargs.waterline_collections = ontology.collections;
        kwargs.logger.info('Waterline initialised with:', Object.keys(kwargs.waterline_collections), ';');
        kwargs._cache['waterline_collections'] = kwargs.waterline_collections;
        return callback(null, { connections: ontology.connections, collections: kwargs.waterline_collections });
    });
};
const typeormHandler = (kwargs, typeorm, callback) => {
    if (kwargs.skip_typeorm)
        return callback(void 0);
    kwargs.logger.info('TypeORM initialising with:', Array.from(typeorm.keys()), ';');
    try {
        return typeorm_1.createConnection(Object.assign({
            entities: Array.from(typeorm.values())
        }, kwargs.typeorm_config)).then(connection => callback(null, connection)).catch(callback);
    }
    catch (e) {
        return callback(e);
    }
};
const sequelizeHandler = (kwargs, app, sequelize_map, callback) => {
    if (kwargs.skip_sequelize)
        return callback(void 0);
    kwargs.logger.info('Sequelize initialising with:', Array.from(sequelize_map.keys()), ';');
    const sequelize_obj = new sequelize.Sequelize(kwargs.sequelize_config);
    Array.from(sequelize_map.values()).forEach(e => e(sequelize_obj));
    return callback(void 0, sequelize_obj);
};
exports.tearDownWaterlineConnections = (connections, done) => connections ? async_1.parallel(Object.keys(connections).map(connection => connections[connection]._adapter.teardown), () => {
    Object.keys(connections).forEach(connection => {
        if (['sails-tingo', 'waterline-nedb'].indexOf(connections[connection]._adapter.identity) < 0)
            connections[connection]._adapter.connections.delete(connection);
    });
    return done();
}) : done();
exports.tearDownTypeOrmConnection = (connection, done) => connection != null && connection.isConnected ? connection.close().then(_ => done()).catch(done) : done();
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
    if (kwargs.skip_sequelize == null)
        kwargs.skip_sequelize = true;
    if (kwargs.skip_typeorm == null)
        kwargs.skip_typeorm = true;
    if (kwargs.skip_waterline == null)
        kwargs.skip_waterline = true;
    if (kwargs.skip_redis == null)
        kwargs.skip_redis = true;
    else if (kwargs.redis_config == null)
        kwargs.redis_config = process.env['REDIS_URL'] == null ? { port: 6379 } : process.env['REDIS_URL'];
    const app = restify.createServer(Object.assign({ name: kwargs.app_name }, kwargs.createServerArgs || {}));
    app.use(restify_plugins_1.queryParser());
    app.use(restify_plugins_1.bodyParser());
    app.on('WLError', (req, res, err, next) => next(new custom_restify_errors_1.WaterlineError(err)));
    if (!kwargs.skip_app_logging)
        app.on('after', restify_plugins_1.auditLogger({
            log: bunyan_1.createLogger({
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
    if (!(kwargs.models_and_routes instanceof Map))
        kwargs.models_and_routes = nodejs_utils_1.model_route_to_map(kwargs.models_and_routes);
    for (const [fname, program] of kwargs.models_and_routes)
        if (program != null)
            if (fname.indexOf('model') > -1 && (!kwargs.skip_waterline || !kwargs.skip_typeorm))
                populateModels(program, kwargs.omit_models || ['AccessToken'], norm, waterline_set, typeorm_map, sequelize_map);
            else
                typeof program === 'object' && Object.keys(program).map((route) => program[route](app, `${kwargs.root}/${path_1.dirname(fname)}`)) && routes.add(path_1.dirname(fname));
    kwargs.logger.info('Registered routes:', Array.from(routes.keys()).join('; '), ';');
    kwargs.logger.warn('Failed registering models:', Array.from(norm.keys()).join('; '), ';');
    if (!kwargs.skip_redis) {
        kwargs.redis_cursors.redis = new Redis(kwargs.redis_config);
        kwargs.redis_cursors.redis.on('error', err => {
            kwargs.logger.error(`Redis::error event -
            ${kwargs.redis_cursors.redis['host']}:${kwargs.redis_cursors.redis['port']}s- ${err}`);
            kwargs.logger.error(err);
        });
    }
    async_1.parallel({
        sequelize: cb => sequelizeHandler(kwargs, app, sequelize_map, cb),
        typeorm: cb => typeormHandler(kwargs, typeorm_map, cb),
        waterline: cb => waterlineHandler(kwargs, app, waterline_set, cb),
    }, (err, result) => {
        if (err != null) {
            if (kwargs.callback)
                return kwargs.callback(err);
            throw err;
        }
        return handleStartApp(kwargs, app, (result.waterline || {}).connections, (result.waterline || {}).collections, result.typeorm, result.sequelize);
    });
};
exports.add_to_body_mw = (...updates) => (req, res, next) => {
    req.body && updates.map(pair => req.body[pair[0]] = updates[pair[1]]);
    return next();
};
