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
const typeorm_1 = require("typeorm");
require("reflect-metadata");
const populateModels = (waterline_obj, program, models_set, norm_set, typeorm_map) => Object
    .keys(program)
    .forEach(entity => {
    if (program[entity] != null)
        if (program[entity].identity || program[entity].tableName) {
            models_set.add(entity);
            waterline_obj.loadCollection(waterline_1.Collection.extend(program[entity]));
        }
        else if (typeof program[entity] === 'function'
            && program[entity].toString().indexOf('class') > -1
            && entity !== 'AccessToken')
            typeorm_map.set(entity, program[entity]);
        else
            norm_set.add(entity);
});
const handleStartApp = (kwargs, app, waterline_connections, waterline_collections, typeorm_connection) => kwargs.skip_start_app ? kwargs.callback != null &&
    kwargs.callback(null, app, waterline_connections, waterline_collections, typeorm_connection)
    : app.listen(kwargs.listen_port, () => {
        kwargs.logger.info('%s listening at %s', app.name, app.url);
        if (kwargs.onServerStart != null)
            return kwargs.onServerStart(app.url, waterline_connections, kwargs.waterline_collections, typeorm_connection, app, kwargs.callback == null ? () => { } : kwargs.callback);
        else if (kwargs.callback != null)
            return kwargs.callback(null, app, waterline_connections, waterline_collections, typeorm_connection);
    });
const waterlineHandler = (kwargs, app, waterline_obj, waterline_models, callback) => {
    if (kwargs.skip_waterline)
        return callback(void 0);
    kwargs.logger.info('Registered Waterline models:', Array.from(waterline_models.keys()).join('; '), ';');
    waterline_obj.initialize(kwargs.waterline_config, (err, ontology) => {
        if (err != null)
            return handleErr(kwargs.callback)(err);
        else if (ontology == null || ontology.connections == null || ontology.collections == null
            || ontology.connections.length === 0 || ontology.collections.length === 0) {
            kwargs.logger.error('waterline_obj.initialize::ontology =', ontology, ';');
            return handleErr(kwargs.callback)(new TypeError('Expected ontology with connections & waterline_collections'));
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
        }, kwargs.typeorm_config)).then(connection => callback(null, connection)).catch(handleErr(kwargs.callback));
    }
    catch (e) {
        return handleErr(e);
    }
};
const handleErr = (callback) => err => {
    if (callback)
        return callback(err);
    throw err;
};
exports.strapFramework = (kwargs) => {
    if (kwargs.root == null)
        kwargs.root = '/api';
    if (kwargs.skip_app_logging == null)
        kwargs.skip_app_logging = true;
    if (kwargs.skip_start_app == null)
        kwargs.skip_start_app = false;
    if (kwargs.listen_port == null)
        kwargs.listen_port = typeof process.env['PORT'] === 'undefined' ? 3000 : ~~process.env['PORT'];
    if (kwargs.skip_waterline == null)
        kwargs.skip_waterline = true;
    if (kwargs.skip_typeorm == null)
        kwargs.skip_typeorm = true;
    if (kwargs.skip_redis == null)
        kwargs.skip_redis = true;
    else if (kwargs.skip_redis && kwargs.redis_config == null)
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
    ['/', '/version', '/api', '/api/version'].map(route_path => app.get(route_path, (req, res, next) => {
        res.json({ version: kwargs.package_.version });
        return next();
    }));
    const waterline_obj = new Waterline();
    const routes = new Set();
    const waterline_models = new Set();
    const norm = new Set();
    const typeorm = new Map();
    if (!(kwargs.models_and_routes instanceof Map))
        kwargs.models_and_routes = nodejs_utils_1.model_route_to_map(kwargs.models_and_routes);
    for (const [fname, program] of kwargs.models_and_routes)
        if (program != null)
            if (fname.indexOf('model') > -1 && (!kwargs.skip_waterline || !kwargs.skip_typeorm))
                populateModels(waterline_obj, program, waterline_models, norm, typeorm);
            else
                routes.add(Object.keys(program).map((route) => program[route](app, `${kwargs.root}/${path_1.dirname(fname)}`)) && path_1.dirname(fname));
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
        typeorm: cb => typeormHandler(kwargs, typeorm, cb),
        waterline: cb => waterlineHandler(kwargs, app, waterline_obj, waterline_models, cb),
    }, (err, result) => {
        if (err != null)
            return handleErr(kwargs.callback)(err);
        return handleStartApp(kwargs, app, (result.waterline || {}).connections, (result.waterline || {}).collections, result.typeorm);
    });
};
exports.add_to_body_mw = (...updates) => (req, res, next) => {
    req.body && updates.map(pair => req.body[pair[0]] = updates[pair[1]]);
    return next();
};
