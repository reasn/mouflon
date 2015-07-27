/// <reference path="../../definitions/node/node.d.ts" />
/// <reference path="../../definitions/Q/Q.d.ts" />
/// <reference path="../../definitions/sprintf/sprintf.d.ts" />
var __extends = this.__extends || function (d, b) {
        for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
        function __() { this.constructor = d; }
        __.prototype = b.prototype;
        d.prototype = new __();
    };
var Q = require('q');
var AbstractService = require('./AbstractService');
var VendorSshClient = require('node-sshclient');
var color = require('cli-color');
var sprintf = require('sprintf-js').sprintf;
var SshService = (function (_super) {
    __extends(SshService, _super);
    function SshService() {
        _super.apply(this, arguments);
        this.sshClients = [];
        this.scpClients = [];
    }
    SshService.prototype.exec = function (command) {
        var deferred = Q.defer(), clients = this.getSshClient(), that = this;
        this.services.log.logCommand('SSH cmd: ' + command);
        clients.forEach(function(client){
            client.command(command, function (procResult) {
                that.services.log.logCommand('SSH Server: ' + client.options.hostname);
                var resultString = sprintf('Response (code %s): "%s", err: "%s"', procResult.exitCode, procResult.stdout, procResult.stderr);
                if (procResult.exitCode !== 0) {
                    deferred.reject(resultString);
                }
                else {
                    //this.services.log.logResult(resultString);
                    deferred.resolve(procResult);
                }
            });
        });

        return deferred.promise;
    };
    SshService.prototype.upload = function (filename, remoteFilename) {
        var _this = this;
        var deferred = Q.defer();

        this.getScpClient().forEach(function(scpClient){
            _this.services.log.startSection(sprintf('Uploading "%s" to "%s"', filename, remoteFilename));
            scpClient.upload(filename, remoteFilename, function (procResult) {
                if (procResult.exitCode !== 0) {
                    deferred.reject(procResult.stderr);
                    return;
                }
                _this.services.log.closeSection('Upload complete');
                deferred.resolve(procResult);
            });
        })
        return deferred.promise;
    };
    SshService.prototype.getSshClient = function () {
        var server, hosts = [], that = this;
        if (this.sshClients.length < 1) {
            server = this.services.config.getStageConfig().server;
            if (!(server.host instanceof Array)) {
                hosts.push(server.host);
            } else {
                hosts = server.host;
            }

            hosts.forEach(function(host){
                var port = host.match('(?:\:)[^\:]*$');
                host = (''+host).replace(port,'');
                port = port == null ? server.port : (''+port).replace(':','');

                var user = host.match('^.*?(?=\@)');
                host = host.replace(user,'');
                host = host.replace('@','');
                user = user == null ? server.user : (''+user).replace('@','');

                that.services.log.logCommand(sprintf('Connecting SSH to %s@%s:%s ...', user, host, port));

                that.sshClients.push(new VendorSshClient.SSH({
                        hostname: host,
                        user: user,
                        port: port
                    })
                );
            });

        }
        return this.sshClients;
    };
    SshService.prototype.getScpClient = function () {
        var server, hosts = [], that = this;
        if (this.scpClients.length < 1) {
            server = this.services.config.getStageConfig().server;
            if (!(server.host instanceof Array)) {
                hosts.push(server.host);
            } else {
                hosts = server.host;
            }

            hosts.forEach(function(host){

                var port = host.match('(?:\:)[^\:]*$');
                host = (''+host).replace(port,'');
                port = port == null ? server.port : (''+port).replace(':','');

                var user = host.match('^.*?(?=\@)');
                host = host.replace(user,'');
                host = host.replace('@','');
                user = user == null ? server.user : (''+user).replace('@','');

                that.services.log.logCommand(sprintf('Connecting SCP to %s@%s:%s ...', user, host, port));

                that.scpClients.push(new VendorSshClient.SCP({
                        hostname: host,
                        user: user,
                        port: port
                    })
                );
            });
        }
        return this.scpClients;
    };
    return SshService;
})(AbstractService);
module.exports = SshService;
