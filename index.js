import axios from 'axios';
import utils from 'barrkeep/utils';
import events from '@metastack/events';
const qs = require('querystring');

const paramsRegExp = /\/:([^/]+)/g;

const defaults = {
  headers: {},
  withCredentials: false,
};

const state = {};

export default {
  install (Vue) {
    // Filters
    Vue.filter('capitalize', utils.capitalize);
    Vue.filter('round', utils.round);

    // Event handlers
    const $events = new events.EventBus();
    Vue.prototype.$events = $events;

    // API Interface
    const mock = (options, response = {}) => Promise.resolve(response);

    function api (method, url, options) {
      const config = utils.clone(defaults);

      config.url = url;
      config.data = {};

      if (method === 'upload') {
        config.method = 'post';
        config.headers['Content-Type'] = 'multipart/form-data';
      } else {
        config.method = method;
      }

      const params = { };
      for (let param = paramsRegExp.exec(url); param !== null; param = paramsRegExp.exec(url)) {
        params[param[1]] = param[0];
      }

      for (const key in options) {
        const value = options[key];

        if (key in params) {
          const path = params[key];
          config.url = config.url.replace(path, `/${ value }`);
        } else if (key === 'data' || key === 'body') {
          config.data = value;
        } else if (key === 'params' || key === 'query' || key === 'qs') {
          if (typeof value === 'string') {
            config.params = qs.parse(value);
          } else {
            config.params = value;
          }
        } else if (key === 'headers') {
          Object.assign(config.headers, value);
        } else if (key === 'auth' || key === 'authorization') {
          config.auth = value;
        } else if (key === 'status') {
          config.validateStatus = (status) => status === value;
        } else if (key === 'responseType') {
          config.reponseType = value;
        } else if (key === 'responseEncoding') {
          config.responseEncoding = value;
        } else if (key === 'progress' && typeof value === 'function') {
          config.onUploadProgress = value;
        } else {
          config.data[key] = value;
        }
      }

      return axios(config);
    }

    const $api = {
      del: (url, options) => api('delete', url, options),
      delete: (url, options) => api('delete', url, options),
      get: (url, options) => api('get', url, options),
      head: (url, options) => api('head', url, options),
      mock: (url, options, response) => mock(options, response),
      opts: (url, options) => api('options', url, options),
      patch: (url, options) => api('patch', url, options),
      post: (url, options) => api('post', url, options),
      put: (url, options) => api('put', url, options),

      upload: (url, options) => api('upload', url, options),
    };

    Vue.prototype.$api = $api;

    // Events Socket
    function EventsSocket (name, url, options) {
      this.socket = null;
      this.connected = false;

      // Configuration
      this.name = name;
      this.url = url;
      this.persistent = false;
      this.auto = false;
      this.retries = 100;
      this.delay = 500;

      this.configure = (config) => {
        if (config.name) {
          this.name = config.name;
        }

        if (config.url) {
          this.url = config.url;
        }

        if (config.persistent !== undefined) {
          this.persistent = config.persistent;
        }

        if (config.auto !== undefined) {
          this.auto = config.auto;
        }

        if (typeof config.retries === 'number') {
          this.retries = config.retries;
        }

        if (typeof config.delay === 'number') {
          this.delay = config.delay;
        }
      };

      let retries = 0;
      let timer;

      this.reconnect = () => {
        if (timer) {
          clearTimeout(timer);
        }

        if (++retries < this.retries) {
          timer = setTimeout(this.connect, this.delay);
        }
      };

      this.connect = () => {
        this.socket = new WebSocket(this.url);
        this.socket.binaryType = 'arraybuffer';

        this.socket.onopen = () => {
          if (timer) {
            clearTimeout(timer);
          }
          retries = 0;
          this.connected = true;
        };

        this.socket.onclose = () => {
          this.connected = false;
          if (this.persistent) {
            this.reconnect();
          }
        };

        this.socket.onerror = (error) => {
          this.connected = false;

          $events.emit({
            type: `${ this.name }:ws:error`,
            data: error,
          });

          if (this.persistent) {
            this.reconnect();
          }
        };

        this.socket.onmessage = (message) => {
          try {
            if (message.data instanceof ArrayBuffer) {
              const typeView = new Uint8Array(message.data, 0, 1);
              if (typeView[0] === 0) {
                const image = utils.deserializeImageUpdate(message.data);

                $events.emit({
                  type: `${ this.name }:ws:image`,
                  data: image,
                });
              } else {
                console.log(`${ this.name }: unknown message type`, typeView[0]);
              }
            } else {
              const event = JSON.parse(message.data);
              if (event.type) {
                $events.emit(event);
              } else {
                $events.emit({
                  type: `${ this.name }:ws:message`,
                  data: event,
                });
              }
            }
          } catch (error) {
            console.log(`${ this.name }: websocket error`, error);
          }
        };
      };

      this.close = () => {
        if (this.socket && this.connected) {
          this.socket.close();
        }
      };

      this.send = (object) => {
        if (this.connected && this.socket.readyState === 1) {
          try {
            const message = JSON.stringify(object);
            this.socket.send(message);
          } catch (error) {
            console.log(`${ this.name }: websocket error`, error);
          }
        }
      };

      this.ensure = () => {
        if (!this.connected) {
          this.connect();
        }
      };

      if (options) {
        this.configure(options);
      }

      if (this.auto) {
        this.connect();
      }
    }

    Vue.prototype.$EventsSocket = EventsSocket;

    // Navigation
    Vue.prototype.$navigate = function (where) {
      if (typeof where === 'string' && (!this.$router.currentRoute || this.$router.currentRoute.name !== where)) {
        this.$router.push({ name: where });
      } else if (typeof where === 'object') {
        this.$router.push(where);
      }
    };

    // Sessions
    Vue.prototype.$session = function (session) {
      if (session) {
        state.session = session;

        defaults.headers.Authorization = `Bearer ${ session.id }`;
      } else {
        state.session = null;

        delete defaults.headers.Authorization;

        this.$navigate('signin');
      }
    };

    // Local Storage
    Vue.prototype.$storage = {
      clear: () => {
        window.localStorage.clear();
      },
      getItem: (key) => JSON.parse(window.localStorage.getItem(key)),
      setItem: (key, value) => {
        window.localStorage.setItem(key, JSON.stringify(value));
      },
    };

    // Theme hook placeholder
    Vue.prototype.$theme = {};
  },
};
