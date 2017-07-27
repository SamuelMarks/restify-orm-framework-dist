"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const restify = require("restify");
const restify_plugins_1 = require("restify-plugins");
const Waterline = require("waterline");
const waterline_1 = require("waterline");
const bunyan_1 = require("bunyan");
const custom_restify_errors_1 = require("custom-restify-errors");
const Redis = require("ioredis");
exports.strapFramework = (kwargs) => {
    if (kwargs.root == null)
        kwargs.root = '/api';
    if (kwargs.app_logging == null)
        kwargs.app_logging = true;
    if (kwargs.start_app == null)
        kwargs.start_app = true;
    if (kwargs.listen_port == null)
        kwargs.listen_port = typeof process.env['PORT'] === 'undefined' ? 3000 : ~~process.env['PORT'];
    if (kwargs.skip_db == null)
        kwargs.skip_db = true;
    if (kwargs.use_redis == null)
        kwargs.use_redis = false;
    else if (kwargs.use_redis && kwargs.redis_config == null)
        kwargs.redis_config = process.env['REDIS_URL'] == null ? { port: 6379 } : process.env['REDIS_URL'];
    const app = restify.createServer(Object.assign({ name: kwargs.app_name }, kwargs.createServerArgs || {}));
    app.use(restify_plugins_1.queryParser());
    app.use(restify_plugins_1.bodyParser());
    app.on('WLError', (req, res, err, next) => next(new custom_restify_errors_1.WaterlineError(err)));
    if (kwargs.app_logging)
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
    const tryTblInit = (program, models_set, norm_set) => Object.keys(program).forEach(entity => program[entity] != null && (program[entity].identity || program[entity].tableName) ?
        models_set.add(entity) && waterline_obj.loadCollection(waterline_1.Collection.extend(program[entity]))
        : norm_set.add(entity));
    const routes = new Set();
    const models = new Set();
    const norm = new Set();
    for (const [fname, program] of kwargs.models_and_routes)
        if (program != null)
            if (fname.indexOf('model') > -1 && !kwargs.skip_db)
                tryTblInit(program, models, norm);
            else
                routes.add(Object.keys(program).map((route) => program[route](app, `${kwargs.root}/${path_1.dirname(fname)}`)) && path_1.dirname(fname));
    kwargs.logger.info('Registered routes:', Array.from(routes.keys()).join('; '), ';');
    kwargs.logger.warn('Failed registering models:', Array.from(norm.keys()).join('; '), ';');
    kwargs.logger.info('Registered models:', Array.from(models.keys()).join('; '), ';');
    if (kwargs.use_redis) {
        kwargs.redis_cursors.redis = new Redis(kwargs.redis_config);
        kwargs.redis_cursors.redis.on('error', err => {
            kwargs.logger.error(`Redis::error event -
            ${kwargs.redis_cursors.redis['host']}:${kwargs.redis_cursors.redis['port']}s- ${err}`);
            kwargs.logger.error(err);
        });
    }
    if (kwargs.skip_db)
        if (kwargs.start_app)
            app.listen(kwargs.listen_port, () => {
                kwargs.logger.info('%s listening at %s', app.name, app.url);
                return kwargs.callback == null ? null
                    : kwargs.callback(null, app, Object.freeze([]), Object.freeze([]));
            });
        else if (kwargs.callback != null)
            return kwargs.callback(null, app, Object.freeze([]), Object.freeze([]));
    waterline_obj.initialize(kwargs.waterline_config, (err, ontology) => {
        if (err != null) {
            if (kwargs.callback != null)
                return kwargs.callback(err);
            throw err;
        }
        else if (ontology == null || ontology.connections == null || ontology.collections == null
            || ontology.connections.length === 0 || ontology.collections.length === 0) {
            kwargs.logger.error('ontology =', ontology, ';');
            const error = new TypeError('Expected ontology with connections & collections');
            if (kwargs.callback != null)
                return kwargs.callback(error);
            throw error;
        }
        kwargs.collections = ontology.collections;
        kwargs.logger.info('ORM initialised with collections:', Object.keys(kwargs.collections), ';');
        kwargs._cache['collections'] = kwargs.collections;
        if (kwargs.start_app)
            app.listen(process.env['PORT'] || 3000, () => {
                kwargs.logger.info('%s listening from %s;', app.name, app.url);
                if (kwargs.onServerStart != null)
                    kwargs.onServerStart(app.url, ontology.connections, kwargs.collections, app, kwargs.callback == null ? () => { } : kwargs.callback);
                else if (kwargs.callback != null)
                    return kwargs.callback(null, app, ontology.connections, kwargs.collections);
                return;
            });
        else if (kwargs.callback != null)
            return kwargs.callback(null, app, ontology.connections, kwargs.collections);
    });
};
exports.add_to_body_mw = (...updates) => (req, res, next) => {
    req.body && updates.map(pair => req.body[pair[0]] = updates[pair[1]]);
    return next();
};
