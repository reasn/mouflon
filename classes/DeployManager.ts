/// <reference path="../definitions/node/node.d.ts" />
/// <reference path="../definitions/node-git.d.ts" />
/// <reference path="../definitions/rimraf.d.ts" />
/// <reference path="../definitions/Q/Q.d.ts" />
/// <reference path="../definitions/js-yaml/js-yaml.d.ts" />

import Git = require('git');
import fs = require('fs');
import rimraf = require('rimraf');
import Q = require('q');
import jsyaml = require('js-yaml');

import GlobalConfig = require('./Config/GlobalConfig');
import Paths = require('./Config/Paths');

import ServiceContainer = require('./Service/ServiceContainer');

import LocalBashTask = require('./Task/Local/LocalBashTask');
import BowerTask = require('./Task/Local/BowerTask');
import ComposerTask = require('./Task/Local/ComposerTask');
import GruntTask = require('./Task/Local/GruntTask');
import NodeTask = require('./Task/Local/NodeTask');
import TaskDefinition = require('./Task/TaskDefinition');

import RemoteBashTask = require('./Task/Remote/RemoteBashTask');
import LinkedDirTask = require('./Task/Remote/LinkedDirTask');

var merge: any = require('merge-recursive');

class DeployManager {

    private services: ServiceContainer;

    constructor( serviceContainer: ServiceContainer ) {
        this.services = serviceContainer;
    }

    deploy() {
        return [
            this.loadGlobalConfig.bind(this),
            this.loadProjectConfig.bind(this),
            this.cache.bind(this),
            this.checkout.bind(this),
            this.build.bind(this),
            this.transfer.bind(this),
            this.finalize.bind(this),
            this.cleanUp.bind(this)
        ].reduce(Q.when, Q(null));
    }

    private build(): Q.Promise<boolean> {

        var tasks = [];

        this.services.log.logStart('Executing local build tasks');
        if (this.services.config.projectConfig.localTasks && this.services.config.projectConfig.localTasks.length > 0) {
            this.services.config.projectConfig.localTasks.forEach(( task: TaskDefinition ) => {
                var Class;
                switch (task.task) {
                    case 'composer':
                        Class = ComposerTask;
                        break;
                    case 'node':
                        Class = NodeTask;
                        break;
                    case 'bower':
                        Class = BowerTask;
                        break;
                    case 'grunt':
                        Class = GruntTask;
                        break;
                    case 'bash':
                        Class = LocalBashTask;
                        break;
                    default:
                        this.services.log.warn('Ignoring unknown task type "' + task.task + '".');
                        return;
                }

                var instance = new Class(this.services, task.prefs ? task.prefs : {});
                if (task.mod) {
                    instance.modify(task.mod);
                }
                tasks.push(instance.execute.bind(instance));
            });
        }
        return tasks.reduce(Q.when, Q(null));

    }

    private finalize(): Q.Promise<boolean> {
        var tasks = [];

        this.services.log.logStart('Executing remote tasks to finalize project');

        if (this.services.config.projectConfig.remoteTasks && this.services.config.projectConfig.remoteTasks.length > 0) {
            this.services.config.projectConfig.remoteTasks.forEach(( task: TaskDefinition ) => {
                var Class;
                switch (task.task) {
                    case 'bash':
                        Class = RemoteBashTask;
                        break;
                    case 'linkedDirs':
                        Class = LinkedDirTask;
                        break;
                    default:
                        this.services.log.warn('Ignoring unknown task type "' + task.task + '".');
                        return;
                }

                var instance = new Class(this.services, task.prefs ? task.prefs : {});
                tasks.push(instance.execute.bind(instance));
            });
        }
        return tasks.reduce(Q.when, Q(null));
    }

    private transfer() {
        var config = this.services.config,
            configDir = config.paths.getTemp() + config.projectName + '/_config-' + this.services.config.timestamp,
            queue = [],
            configPresent = fs.existsSync(config.paths.getConfig() + config.projectName + '/' + config.stageName);

        if (configPresent) {
            queue.push(()=> {
                this.services.log.logStart('Adding config files to package');
                return this.services.shell.exec('mkdir ' + configDir, true);
            });
            queue.push(()=> {
                return this.services.shell.exec('cp -r ' + config.paths.getConfig() + config.projectName + '/' + config.stageName + '/* ' + configDir, true).then(()=> {
                    this.services.log.logEnd('Config files added to package');
                });
            });
        }

        this.services.log.logStart('Packing files');

        queue.push(() => {
            this.services.shell.exec('tar -zcf ../' + config.projectName + '.tar.gz .').then(() => {
                this.services.log.logStart('Files packed');
            });
        });

        queue.push(()=> {
            this.services.log.logStart('Transferring files');

            return this.services.transfer.transfer(configPresent).then(() => {
                this.services.log.logEnd('Files transferred');
            });
        });

        return queue.reduce(Q.when, Q(null));
    }


    private loadGlobalConfig(): Q.Promise<boolean> {
        var config = this.services.config,
            settingsDir = config.paths.getSettings(),
            d = Q.defer<boolean>();

        fs.readFile(settingsDir + 'settings.yml', ( err, settingsBuffer: Buffer ) => {
            if (err) {
                d.reject(err);
                return;
            }

            fs.readFile(settingsDir + 'local_override.yml', ( err, overrideBuffer: Buffer ) => {
                var overrideSettings;
                if (err) {
                    this.services.log.warn('Could not load ' + settingsDir + 'local_override.yml');
                    overrideSettings = {};
                } else {
                    overrideSettings = jsyaml.load('' + overrideBuffer);
                    if (!overrideSettings) {
                        overrideSettings = {};
                    }
                }

                config.globalConfig = <GlobalConfig> merge(
                    jsyaml.load('' + settingsBuffer),
                    overrideSettings
                );

                if (err) {
                    this.services.log.logEnd('Global config loaded');
                } else {
                    this.services.log.logEnd('Global config (and local overrides) loaded');
                }
                d.resolve(true);
            });
        });
        return d.promise;
    }

    private loadProjectConfig(): Q.Promise<boolean> {
        var config = this.services.config,
            settingsDir = config.paths.getSettings(),
            d = Q.defer<boolean>();

        this.services.log.logStart('Loading project specific config from ' + settingsDir + 'projects/' + config.projectName + '/settings.yml');

        fs.readFile(settingsDir + 'projects/' + config.projectName + '/settings.yml', ( err, data: Buffer ) => {
            if (err) {
                d.reject(err);
                return;
            }
            config.projectConfig = jsyaml.load('' + data);
            this.services.log.logEnd('Project specific config loaded');

            if (config.projectConfig.stages[config.stageName] === undefined) {
                d.reject('No stage named "' + config.stageName + '" found in ' + settingsDir + '/projects/' + config.projectName + '/settings.yml');
            } else {
                d.resolve(true);
            }
        });
        return d.promise;
    }

    private cache(): Q.Promise<boolean> {
        var config = this.services.config,
            stageConfig = config.getStageConfig(),
            cacheDir = config.paths.getCache(),
            promise;

        this.services.log.logStart('Updating local cache');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir);
        }
        if (fs.existsSync(cacheDir + config.projectName)) {
            promise = this.services.shell.exec('cd ' + cacheDir + config.projectName + '; git fetch && git checkout ' + stageConfig.branch + ' && git pull')
        } else {
            promise = this.services.shell.exec('git clone -b ' + stageConfig.branch + ' ' + config.projectConfig.repo.url + ' ' + cacheDir + config.projectName);
        }
        promise.then(()=> {
            this.services.log.logEnd('Local cache updated');
        });
        return promise;
    }

    private checkout(): Q.Promise<boolean> {

        var config = this.services.config,
            stageConfig = config.getStageConfig(),
            deferred = Q.defer<boolean>(),
            tempDir = config.paths.getTemp(),
            git = new Git.Git(tempDir + config.projectName),
            cacheParam = ' --reference ' + config.paths.getCache() + config.projectName;

        this.services.log.logStart('Checking out branch "' + stageConfig.branch + '" from "' + config.projectConfig.repo.url + '"...');

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }
        if (fs.existsSync(tempDir + config.projectName)) {
            rimraf.sync(tempDir + config.projectName);
        }
        if (fs.existsSync(tempDir + config.projectName + '.tar.gz')) {
            fs.unlinkSync(tempDir + config.projectName + '.tar.gz');
        }
        fs.mkdirSync(tempDir + config.projectName);

        var command = 'clone -b ' + stageConfig.branch + cacheParam + ' ' + config.projectConfig.repo.url + ' ' + tempDir + config.projectName;
        console.log(command);
        git.git(command, ( err, result ) => {
            if (err) {
                deferred.reject(err);
                return;
            }
            this.services.log.logEnd('Branch successfully checked out');
            deferred.resolve(true);
        });
        return deferred.promise;
    }

    private cleanUp() {
        this.services.log.logStart('Purging temporary files');
        return this.services.shell.exec('cd ' + this.services.config.paths.getTemp() + '; rm -rf ..?* .[!.]* *', true).then(() => {
            this.services.log.logEnd('Temporary files purged.');
        });
    }
}

export = DeployManager;