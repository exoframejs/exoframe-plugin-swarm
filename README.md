# Docker Swarm support plugin for Exoframe Server

A plugin that adds basic Docker Swarm support to Exoframe Server.

[![Build Status](https://travis-ci.org/exoframejs/exoframe-plugin-swarm.svg?branch=master)](https://travis-ci.org/exoframejs/exoframe-plugin-swarm)
[![Coverage Status](https://coveralls.io/repos/github/exoframejs/exoframe-plugin-swarm/badge.svg?branch=master)](https://coveralls.io/github/exoframejs/exoframe-plugin-swarm?branch=master)
[![license](https://img.shields.io/github/license/mashape/apistatus.svg)](https://opensource.org/licenses/MIT)

## Installation, usage and docs

To enable - add the plugin to your exoframe-server config file and restart the server.  
Your plugins section of server config should look like this:

```yaml
plugins:
  install: ['exoframe-plugin-swarm']
  swarm:
    enabled: true
```

For more details on how to get it up and running please follow the guide on [how to use plugins in exoframe-server](https://github.com/exoframejs/exoframe/tree/master/docs).

## License

Licensed under MIT.
