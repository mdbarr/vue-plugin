import axios from 'axios';
import utils from 'barrkeep/utils';
import events from '@metastack/events';
import transforms from 'barrkeep/transforms';
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
    Vue.filter('bytes', transforms.bytes);
    Vue.filter('camelcase', transforms.camelcase);
    Vue.filter('capitalize', transforms.capitalize);
    Vue.filter('currency', transforms.currency);
    Vue.filter('duration', transforms.duration);
    Vue.filter('lowercase', transforms.lowercase);
    Vue.filter('number', transforms.number);
    Vue.filter('reverse', transforms.reverse);
    Vue.filter('round', utils.precisionRound);
    Vue.filter('trim', transforms.trim);
    Vue.filter('uppercase', transforms.uppercase);

    // Utilities
    const $utils = {
      clone: (object) => JSON.parse(JSON.stringify(object)),
      debounce: utils.debounce,
      deepClone: utils.deepClone,
      duration: utils.duration,
      equal: utils.deepEqual,
      expand: utils.expand,
      filter: utils.filter,
      flatten: utils.flatten,
      merge: utils.merge,
      milliseconds: utils.milliseconds,
      once: utils.once,
      project: utils.project,
      remove: utils.remove,
      resolve: utils.resolve,
      resolves: utils.resolves,
      round: utils.precisionRound,
      set (object, path, value, delimiter) {
        if (!object || !path) {
          return false;
        }

        const parts = utils.dividePath(path, delimiter);
        const key = parts.pop();

        for (const part of parts) {
          if (object[part] === undefined) {
            if (typeof part === 'number') {
              object[part] = [];
            } else {
              object[part] = {};
            }
          }

          object = object[part];

          if (!object) {
            return false;
          }
        }

        Vue.set(object, key, value);

        return true;
      },
      size: utils.size,
      timestamp: utils.timestamp,
    };
    Vue.prototype.$utils = $utils;

    // Event handlers
    const $events = new events.EventBus();
    Vue.prototype.$events = $events;

    // API Interface
    const mock = (options, response = {}) => Promise.resolve(response);

    function api (method, url, options) {
      const config = $utils.clone(defaults);

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

    // Event Sockets
    class EventSocket {
      constructor (url, options) {
        this.socket = null;

        this.url = url;
        this.persistent = false;
        this.autoconnect = false;
        this.json = true;

        this.retries = 10;
        this.delay = 500;

        this._connected = false;
        this._timer = null;
        this._retries = 0;

        this._handlers = {
          close: new Set(),
          data: new Set(),
          error: new Set(),
          message: new Set(),
          open: new Set(),
        };

        if (options) {
          this.configure(options);
        }

        if (this.autoconnect) {
          this.connect();
        }
      }

      close () {
        if (this.socket && this._connected) {
          this.socket.close();
        }
      }

      configure ({
        url, persistent, autoconnect, json, retries, delay,
      } = {}) {
        if (url) {
          this.url = url;
        }

        if (persistent !== undefined) {
          this.persistent = persistent;
        }

        if (autoconnect !== undefined) {
          this.autoconnect = autoconnect;
        }

        if (json !== undefined) {
          this.json = json;
        }

        if (typeof retries === 'number') {
          this.retries = Math.max(retries, 0);
        }

        if (typeof delay === 'number') {
          this.delay = Math.max(delay, 0);
        }
      }

      connect () {
        this.socket = new WebSocket(this.url);
        this.socket.binaryType = 'arraybuffer';

        this.socket.onclose = this.onclose;
        this.socket.onerror = this.onerror;
        this.socket.onmessage = this.onmessage;
        this.socket.onopen = this.onopen;
      }

      ensure () {
        if (!this._connected) {
          this.connect();
        }
      }

      off (type, handler) {
        if (type in this._handlers && typeof handler === 'function') {
          this._handlers[type].delete(handler);
        }
      }

      on (type, handler) {
        if (type in this._handlers && typeof handler === 'function') {
          this._handlers[type].add(handler);
        }
      }

      onclose () {
        this._connected = false;

        for (const [ handler ] in this._handlers.close) {
          handler();
        }

        if (this.persistent) {
          this.reconnect();
        }
      }

      onerror (error) {
        this._connected = false;

        for (const [ handler ] in this._handlers.error) {
          handler(error);
        }

        if (this.persistent) {
          this.reconnect();
        }
      }

      onmessage (event) {
        if (this.json) {
          try {
            const json = JSON.parse(event.data);
            for (const [ handler ] in this._handlers.data) {
              handler(json);
            }
          } catch (error) {
            for (const [ handler ] in this._handlers.message) {
              handler(event.data);
            }
          }
        } else {
          for (const [ handler ] in this._handlers.message) {
            handler(event.data);
          }
        }
      }

      onopen () {
        if (this._timer) {
          clearTimeout(this._timer);
        }
        this._retries = 0;
        this._connected = true;

        for (const [ handler ] in this._handlers.open) {
          handler();
        }
      }

      send (data) {
        if (this._connected && this.socket.readyState === WebSocket.OPEN) {
          if (typeof data !== 'object') {
            this.socket.send(data);
          } else {
            try {
              const message = JSON.stringify(data);
              this.socket.send(message);
            } catch (error) {
              console.error(error);
            }
          }
        }
      }
    }

    class EventBusSocket extends EventSocket {
      constructor (name, url, options) {
        super(url, options);

        this.name = name;
        this.events = $events;
      }

      configure (options) {
        super.configure(options);

        if (options.bus) {
          this.events = options.bus;
        }
        if (options.events) {
          this.events = options.events;
        }
      }

      onmessage (message) {
        try {
          const event = JSON.parse(message.data);
          if (event.type) {
            this.events.emit(event);
          } else {
            this.events.emit({
              type: `${ this.name }:ws:message`,
              data: event,
            });
          }
        } catch (error) {
          console.error(`${ this.name }: websocket error`, error);
        }
      }

      send (object) {
        if (this._connected && this.socket.readyState === WebSocket.OPEN) {
          try {
            const message = JSON.stringify(object);
            this.socket.send(message);
          } catch (error) {
            console.error(`${ this.name }: websocket error`, error);
          }
        }
      }
    }

    Vue.prototype.$EventSocket = EventSocket;
    Vue.prototype.$EventBusSocket = EventBusSocket;

    // Navigation
    Vue.prototype.$navigate = function (where) {
      if (typeof where === 'string' &&
        (!this.$router.currentRoute || this.$router.currentRoute.name !== where)) {
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

    // Vuetify Themes
    Vue.prototype.$theme = {
      init () {
        Object.assign(this.$theme, {
          current: () => (this.$vuetify.theme.dark ? 'dark' : 'light'),
          dark: () => {
            this.$vuetify.theme.dark = true;
            this.$theme.save();
          },
          light: () => {
            this.$vuetify.theme.dark = false;
            this.$theme.save();
          },
          save: () => {
            localStorage.setItem('theme', this.$theme.current());
          },
          load: () => {
            if (localStorage.getItem('theme') === 'light') {
              this.$vuetify.theme.dark = false;
            } else {
              this.$vuetify.theme.dark = true;
            }
          },
          toggle: () => {
            if (this.$vuetify.theme.dark) {
              this.$theme.light();
            } else {
              this.$theme.dark();
            }
          },
        });
      },
    };
  },
};
