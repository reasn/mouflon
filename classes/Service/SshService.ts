/// <reference path="../../definitions/node/node.d.ts" />
/// <reference path="../../definitions/Q/Q.d.ts" />
/// <reference path="../../definitions/sprintf/sprintf.d.ts" />

import Q = require('q');
import Shell = require('shelljs');
import async = require('async');

import AbstractService = require('./AbstractService');
import SshResult = require('./SshResult');

var VendorSshClient: any = require('node-sshclient');
var color: any = require('cli-color');
var sprintf: sPrintF.sprintf = require('sprintf-js').sprintf;

class SshService extends AbstractService {

    private sshClients: any = [];
    private scpClients: any = [];

    exec(command: string): Q.Promise<SshResult> {
        var deferred = Q.defer<SshResult>(),
            clients = this.getSshClient();


        this.services.log.logCommand('SSH cmd: ' + command);

        for(var i=0, len=clients.length; i< len; i++){
            var client = clients[i];
            this.services.log.logCommand('Executong cmd on SSH Server: ' + client.options.hostname);
            client.command(command, (procResult: SshResult) => {
                var resultString = sprintf('Response (code %s): "%s", err: "%s"', procResult.exitCode, procResult.stdout, procResult.stderr);
                if (procResult.exitCode !== 0) {
                    deferred.reject(resultString);
                } else {
                    //this.services.log.logResult(resultString);
                    deferred.resolve(procResult);
                }
            });
        }

        return deferred.promise;
    }

    upload(filename: string, remoteFilename: string) {
        var deferred = Q.defer(), scpClients = this.getScpClient();

        for(var i=0, len=scpClients.length; i< len; i++){
            var scpClient = scpClients[i];
            this.services.log.startSection(sprintf('Uploading "%s" to "%s"', filename, remoteFilename));
            scpClient.upload(filename, remoteFilename, (procResult: any) => {
                if (procResult.exitCode !== 0) {
                    deferred.reject(procResult.stderr);
                    return;
                }
                this.services.log.closeSection('Upload complete');
                deferred.resolve(procResult);
            });
        }
        return deferred.promise;
    }

    private getSshClient(): any {
        var server, hosts = [];
        if (this.sshClients.length < 1) {
            server = this.services.config.getStageConfig().server;
            if (!(server.host instanceof Array)) {
                hosts = [];
                hosts.push(server.host);
            } else {
                hosts = server.host;
            }

            for(var i=0, len=hosts.length; i< len; i++){
                var host = hosts[i];
                var port = host.match('(?:\:)[^\:]*$');
                host = (''+host).replace(port,'');
                port = port == null ? server.port : (''+port).replace(':','');

                var user = host.match('^.*?(?=\@)');
                host = host.replace(user,'');
                host = host.replace('@','');
                user = user == null ? server.user : (''+user).replace('@','');
                this.services.log.logCommand(sprintf('Connecting SSH to %s@%s:%s ...', user, host, port));

                this.sshClients.push(new VendorSshClient.SSH({
                        hostname: host,
                        user: user,
                        port: port
                    })
                );
            }

        }
        return this.sshClients;
    }

    private getScpClient(): any {
        var server, hosts = [];

        if (this.scpClients.length < 1) {
            server = this.services.config.getStageConfig().server;
            if (!(server.host instanceof Array)) {
                hosts.push(server.host);
            } else {
                hosts = server.host;
            }

            for(var i=0, len=hosts.length; i< len; i++){
                var host = hosts[i];
                var port = host.match('(?:\:)[^\:]*$');
                host = (''+host).replace(port,'');
                port = port == null ? server.port : (''+port).replace(':','');

                var user = host.match('^.*?(?=\@)');
                host = host.replace(user,'');
                host = host.replace('@','');
                user = user == null ? server.user : (''+user).replace('@','');

                this.services.log.logCommand(sprintf('Connecting SCP to %s@%s:%s ...', user, host, port));

                this.scpClients.push(new VendorSshClient.SCP({
                        hostname: host,
                        user: user,
                        port: port
                    })
                );
            }
        }
        return this.scpClients;
    }
}

export = SshService;