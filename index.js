"use strict";
var restify = require('restify');
var Waterline = require('waterline');
var waterline_1 = require('waterline');
var async = require('async');
var bunyan_1 = require('bunyan');
var restify_errors_1 = require('restify-errors');
var redis_1 = require('redis');
function strapFramework(kwargs) {
    if (kwargs.root === undefined)
        kwargs.root = '/api';
    if (kwargs.start_app === undefined)
        kwargs.start_app = true;
    if (kwargs.skip_db === undefined)
        kwargs.skip_db = true;
    if (kwargs.use_redis === undefined)
        kwargs.use_redis = false;
    if (kwargs.createSampleData === undefined)
        kwargs.createSampleData = !process.env.NO_SAMPLE_DATA;
    var app = restify.createServer();
    app.use(restify.queryParser());
    app.use(restify.bodyParser());
    app.on('WLError', function (req, res, err, next) {
        return next(new restify_errors_1.WaterlineError(err));
    });
    app.on('after', restify.auditLogger({
        log: bunyan_1.createLogger({
            name: 'audit',
            stream: process.stdout
        })
    }));
    ['/', '/version', '/api', '/api/version'].map(function (route_path) { return app.get(route_path, function (req, res, next) {
        res.json({ version: kwargs.package_.version });
        next();
    }); });
    var waterline = new Waterline();
    function tryTblInit(entity) {
        return function tryInit(model) {
            kwargs.models_and_routes[entity].models
                && (kwargs.models_and_routes[entity].models[model].identity
                    ||
                        kwargs.models_and_routes[entity].models[model].tableName)
                ?
                    waterline.loadCollection(waterline_1.Collection.extend(kwargs.models_and_routes[entity].models[model]))
                : kwargs.logger.warn("Not initialising: " + entity + "." + model);
        };
    }
    Object.keys(kwargs.models_and_routes).map(function (entity) {
        if (kwargs.models_and_routes[entity].routes)
            Object.keys(kwargs.models_and_routes[entity].routes).map(function (route) { return kwargs.models_and_routes[entity].routes[route](app, kwargs.root + "/" + entity); });
        if (kwargs.models_and_routes[entity].models)
            Object.keys(kwargs.models_and_routes[entity].models).map(tryTblInit(entity));
    });
    if (kwargs.callback && kwargs.skip_db && !kwargs.start_app)
        return kwargs.callback(app);
    if (kwargs.use_redis) {
        kwargs.redis_cursors.redis = redis_1.createClient(process.env.REDIS_URL);
        kwargs.redis_cursors.redis.on('error', function (err) {
            kwargs.logger.error("Redis::error event -\n            " + kwargs.redis_cursors.redis['host'] + ":" + kwargs.redis_cursors.redis['port'] + "\n            - " + err);
            kwargs.logger.error(err);
        });
    }
    waterline.initialize(kwargs.waterline_config, function (err, ontology) {
        if (err !== null)
            throw err;
        kwargs.collections = (ontology.collections);
        kwargs.logger.info('ORM initialised with collections:', Object.keys(kwargs.collections));
        kwargs._cache['collections'] = kwargs.collections;
        if (kwargs.callback && kwargs.start_app === false)
            return kwargs.callback(app, ontology.connections, kwargs.collections);
        else if (kwargs.start_app)
            app.listen(process.env.PORT || 3000, function () {
                kwargs.logger.info('%s listening at %s', app.name, app.url);
                if (kwargs.createSampleData && kwargs.sampleDataToCreate) {
                    var sampleData = new kwargs.SampleData(app.url);
                    async.series((kwargs.sampleDataToCreate)(sampleData), function (err, results) {
                        return err ? console.error(err) : console.info(results);
                    });
                }
                if (kwargs.callback)
                    return kwargs.callback(app, ontology.connections, kwargs.collections);
            });
    });
}
exports.strapFramework = strapFramework;
