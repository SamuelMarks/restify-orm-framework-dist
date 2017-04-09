"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var restify = require("restify");
var Waterline = require("waterline");
var waterline_1 = require("waterline");
var async = require("async");
var bunyan_1 = require("bunyan");
var restify_errors_1 = require("restify-errors");
var redis_1 = require("redis");
var util_1 = require("util");
function strapFramework(kwargs) {
    if (kwargs.root === undefined)
        kwargs.root = '/api';
    if (kwargs.app_logging === undefined)
        kwargs.app_logging = true;
    if (kwargs.start_app === undefined)
        kwargs.start_app = true;
    if (kwargs.skip_db === undefined)
        kwargs.skip_db = true;
    if (kwargs.use_redis === undefined)
        kwargs.use_redis = false;
    if (kwargs.createSampleData === undefined)
        kwargs.createSampleData = !process.env['NO_SAMPLE_DATA'];
    var app = restify.createServer({ name: kwargs.app_name });
    app.use(restify.queryParser());
    app.use(restify.bodyParser());
    app.on('WLError', function (req, res, err, next) {
        return next(new restify_errors_1.WaterlineError(err));
    });
    if (kwargs.app_logging)
        app.on('after', restify.auditLogger({
            log: bunyan_1.createLogger({
                name: 'audit',
                stream: process.stdout
            })
        }));
    ['/', '/version', '/api', '/api/version'].map(function (route_path) { return app.get(route_path, function (req, res, next) {
        res.json({ version: kwargs.package_.version });
        return next();
    }); });
    function tryTblInit(entity) {
        return function (model) {
            kwargs.models_and_routes[entity].models
                && (kwargs.models_and_routes[entity].models[model].identity
                    || kwargs.models_and_routes[entity].models[model].tableName) ?
                waterline.loadCollection(waterline_1.Collection.extend(kwargs.models_and_routes[entity].models[model])) : kwargs.logger.warn("Not initialising: " + entity + "." + model);
        };
    }
    var waterline = new Waterline();
    Object.keys(kwargs.models_and_routes).map(function (entity) {
        if (kwargs.models_and_routes[entity].routes)
            Object.keys(kwargs.models_and_routes[entity].routes).map(function (route) { return kwargs.models_and_routes[entity].routes[route](app, kwargs.root + "/" + entity); });
        if (kwargs.models_and_routes[entity].route)
            Object.keys(kwargs.models_and_routes[entity].route).map(function (route) { return kwargs.models_and_routes[entity].route[route](app, kwargs.root + "/" + entity); });
        if (!kwargs.skip_db && kwargs.models_and_routes[entity].models)
            Object.keys(kwargs.models_and_routes[entity].models).map(tryTblInit(entity));
    });
    if (kwargs.use_redis) {
        kwargs.redis_cursors.redis = redis_1.createClient(process.env['REDIS_URL']);
        kwargs.redis_cursors.redis.on('error', function (err) {
            kwargs.logger.error("Redis::error event -\n            " + kwargs.redis_cursors.redis['host'] + ":" + kwargs.redis_cursors.redis['port'] + "s- " + err);
            kwargs.logger.error(err);
        });
    }
    if (kwargs.skip_db)
        if (kwargs.start_app)
            app.listen(process.env['PORT'] || 3000, function () {
                kwargs.logger.info('%s listening at %s', app.name, app.url);
                return kwargs.callback ?
                    kwargs.callback(null, app, Object.freeze([]), Object.freeze([]))
                    : null;
            });
        else if (kwargs.callback)
            return kwargs.callback(null, app, Object.freeze([]), Object.freeze([]));
    waterline.initialize(kwargs.waterline_config, function (err, ontology) {
        if (err !== null) {
            if (kwargs.callback)
                return kwargs.callback(err);
            throw err;
        }
        else if (util_1.isNullOrUndefined(ontology) || !ontology.connections || !ontology.collections) {
            console.error('ontology =', ontology);
            var err_1 = new TypeError(util_1.format('Expected ontology with connections & collections, got: %j', ontology));
            if (kwargs.callback)
                return kwargs.callback(err_1);
            throw err_1;
        }
        kwargs.collections = (ontology.collections);
        kwargs.logger.info('ORM initialised with collections:', Object.keys(kwargs.collections));
        kwargs._cache['collections'] = kwargs.collections;
        if (kwargs.start_app)
            app.listen(process.env['PORT'] || 3000, function () {
                kwargs.logger.info('%s listening from %s', app.name, app.url);
                if (kwargs.createSampleData && kwargs.sampleDataToCreate)
                    async.series((kwargs.sampleDataToCreate)(new kwargs.SampleData(app.url, ontology.connections, kwargs.collections)), function (err, results) {
                        return err ? console.error(err) : console.info(results);
                    });
                if (kwargs.callback)
                    return kwargs.callback(null, app, ontology.connections, kwargs.collections);
                return;
            });
        else if (kwargs.callback)
            return kwargs.callback(null, app, ontology.connections, kwargs.collections);
    });
}
exports.strapFramework = strapFramework;
function add_to_body_mw() {
    var updates = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        updates[_i] = arguments[_i];
    }
    return function (req, res, next) {
        req.body && updates.map(function (pair) { return req.body[pair[0]] = updates[pair[1]]; });
        return next();
    };
}
exports.add_to_body_mw = add_to_body_mw;
