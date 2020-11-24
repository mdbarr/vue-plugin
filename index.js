import axios from 'axios';
import utils from 'barrkeep/utils';
import events from '@hyperingenuity/events';
import transforms from 'barrkeep/transforms';
const qs = require('querystring');

const paramsRegExp = /\/:([^/]+)/g;

const defaults = {
  headers: {},
  withCredentials: false,
};

let state = {};

export default {
  install (Vue, pluginOptions) {
    // Filters
    Vue.filter('binary', transforms.binary);
    Vue.filter('bytes', transforms.bytes);
    Vue.filter('camelcase', transforms.camelcase);
    Vue.filter('capitalize', transforms.capitalize);
    Vue.filter('currency', transforms.currency);
    Vue.filter('duration', transforms.duration);
    Vue.filter('hexadecimal', transforms.hexadecimal);
    Vue.filter('kebabcase', transforms.kebabcase);
    Vue.filter('lowercase', transforms.lowercase);
    Vue.filter('number', transforms.number);
    Vue.filter('octal', transforms.octal);
    Vue.filter('pascalcase', transforms.pascalcase);
    Vue.filter('pluralize', transforms.pluralize);
    Vue.filter('reverse', transforms.reverse);
    Vue.filter('round', utils.precisionRound);
    Vue.filter('sentencecase', transforms.sentencecase);
    Vue.filter('snakecase', transforms.snakecase);
    Vue.filter('titlecase', transforms.titlecase);
    Vue.filter('trim', transforms.trim);
    Vue.filter('uppercase', transforms.uppercase);

    // Utilities
    const $utils = {
      clone: (object) => JSON.parse(JSON.stringify(object)),
      debounce: utils.debounce,
      deepClone: utils.deepClone,
      distinct: utils.distinct,
      duration: utils.duration,
      equal: utils.deepEqual,
      expand: utils.expand,
      filter: utils.filter,
      flatten: utils.flatten,
      merge: utils.merge,
      milliseconds: utils.milliseconds,
      once: utils.once,
      poll: utils.poll,
      project: utils.project,
      range: utils.range,
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
      times: utils.times,
      timestamp: utils.timestamp,
      unique: utils.unique,
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
      constructor (url = '/', options) {
        this.autoconnect = false;
        this.delay = 500;
        this.json = true;
        this.persistent = false;
        this.retries = 10;
        this.url = this.inferUrl(url);

        this._attempts = 0;
        this._connected = false;
        this._socket = null;
        this._timer = null;

        this._handlers = {
          close: new Set(),
          data: new Set(),
          error: new Set(),
          message: new Set(),
          connect: new Set(),
        };

        if (options) {
          this.configure(options);
        }

        if (this.autoconnect) {
          this.connect();
        }
      }

      close () {
        if (this._socket && this._connected) {
          this._socket.close();
        }

        return this;
      }

      configure ({
        autoconnect, delay, json, persistent, retries, url,
      } = {}) {
        if (autoconnect !== undefined) {
          this.autoconnect = autoconnect;
        }

        if (typeof delay === 'number') {
          this.delay = Math.max(delay, 0);
        }

        if (json !== undefined) {
          this.json = json;
        }

        if (persistent !== undefined) {
          this.persistent = persistent;
        }

        if (typeof retries === 'number') {
          this.retries = Math.max(retries, 0);
        }

        if (url) {
          this.url = this.inferUrl(url);
        }

        return this;
      }

      connect () {
        this._socket = new WebSocket(this.url);
        this._socket.binaryType = 'arraybuffer';

        this._socket.onclose = this.onclose.bind(this);
        this._socket.onerror = this.onerror.bind(this);
        this._socket.onmessage = this.onmessage.bind(this);
        this._socket.onopen = this.onopen.bind(this);

        return this;
      }

      ensure () {
        if (!this._connected) {
          this.connect();
        }

        return this;
      }

      inferUrl (fragment) {
        if (/^wss?:\/\//i.test(fragment)) {
          return fragment;
        }
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const host = window.location.host;
        const path = fragment.startsWith('/') ? fragment : `/${ fragment }`;

        return `${ protocol }://${ host }${ path }`;
      }

      off (type, handler) {
        if (type in this._handlers && typeof handler === 'function') {
          this._handlers[type].delete(handler);
        }

        return this;
      }

      on (type, handler) {
        if (type in this._handlers && typeof handler === 'function') {
          this._handlers[type].add(handler);
        }

        return this;
      }

      onclose () {
        this._connected = false;

        for (const handler of this._handlers.close) {
          handler();
        }

        if (this.persistent) {
          this.reconnect();
        }
      }

      onerror (error) {
        this._connected = false;

        for (const handler of this._handlers.error) {
          handler(error);
        }

        if (this.persistent) {
          this.reconnect();
        }
      }

      onmessage (event) {
        if (event.data !== 'PONG') {
          if (this.json) {
            try {
              const json = JSON.parse(event.data);
              for (const handler of this._handlers.data) {
                handler(json);
              }
            } catch (error) {
              if (this.json === 'strict') {
                throw error;
              } else {
                for (const handler of this._handlers.message) {
                  handler(event.data);
                }
              }
            }
          } else {
            for (const handler of this._handlers.message) {
              handler(event.data);
            }
          }
        }
      }

      onopen () {
        if (this._timer) {
          clearTimeout(this._timer);
        }
        this._attempts = 0;
        this._connected = true;

        for (const handler of this._handlers.connect) {
          handler();
        }
      }

      reconnect () {
        if (this._timer) {
          clearTimeout(this._timer);
        }

        this._attempts += 1;

        if (this._attempts < this.retries) {
          this._timer = setTimeout(this.connect.bind(this), this.delay);
        }
      }

      send (data) {
        if (this._connected && this._socket.readyState === WebSocket.OPEN) {
          if (this.json) {
            try {
              const message = JSON.stringify(data);
              this._socket.send(message);
            } catch (error) {
              if (this.json === 'strict') {
                throw error;
              } else {
                this._socket.send(data.toString());
              }
            }
          } else {
            this._socket.send(data.toString());
          }
        }

        return this;
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

        return this;
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
        if (this._connected && this._socket.readyState === WebSocket.OPEN) {
          try {
            const message = JSON.stringify(object);
            this._socket.send(message);
          } catch (error) {
            console.error(`${ this.name }: websocket error`, error);
          }
        }

        return this;
      }
    }

    Vue.prototype.$EventSocket = EventSocket;
    Vue.prototype.$EventBusSocket = EventBusSocket;

    // Navigation
    Vue.prototype.$navigate = function (where) {
      $events.emit({
        type: 'app:navigation:change',
        data: {
          from: this.$router.currentRoute,
          to: where,
        },
      });

      if (typeof where === 'string' &&
        (!this.$router.currentRoute || this.$router.currentRoute.name !== where)) {
        this.$router.push({ name: where });
      } else if (typeof where === 'object') {
        this.$router.push(where);
      }
    };

    // State - enable shared state for sessioning
    if (pluginOptions.state) {
      state = pluginOptions.state;
    }

    Vue.prototype.$state = (shared) => {
      if (shared) {
        state = shared;
      } else if (shared === null) {
        state = {};
      }

      return state;
    };

    // Sessions
    Vue.prototype.$session = function (session) {
      if (session && session.id) {
        state.session = session;

        defaults.headers.Authorization = `Bearer ${ session.id }`;

        $events.emit({
          type: 'app:session:create',
          data: session,
        });
      } else {
        state.session = null;

        delete defaults.headers.Authorization;

        this.$navigate('signin');

        $events.emit({ type: 'app:session:delete' });
      }
    };

    // Local Storage
    Vue.prototype.$storage = {
      clear: () => {
        window.localStorage.clear();
        $events.emit({ type: 'storage:cleared' });
      },
      getItem: (key) => JSON.parse(window.localStorage.getItem(key)),
      removeItem: (key) => {
        window.localStorage.removeItem(key);
        $events.emit({ type: `storage:${ key }:delete` });
      },
      setItem: (key, value) => {
        window.localStorage.setItem(key, JSON.stringify(value));
        $events.emit({
          type: `storage:${ key }:set`,
          data: value,
        });
      },
    };

    // Vuetify Themes
    Vue.prototype.$theme = {
      init (instance, load = true) {
        Object.assign(instance.$theme, {
          current: () => (instance.$vuetify.theme.dark ? 'dark' : 'light'),
          dark: () => {
            instance.$vuetify.theme.dark = true;
            instance.$theme.save();
            $events.emit({ type: 'app:theme:dark' });
          },
          light: () => {
            instance.$vuetify.theme.dark = false;
            instance.$theme.save();
            $events.emit({ type: 'app:theme:light' });
          },
          save: () => {
            localStorage.setItem('theme', instance.$theme.current());
          },
          load: () => {
            if (localStorage.getItem('theme') === 'light') {
              instance.$vuetify.theme.dark = false;
            } else {
              instance.$vuetify.theme.dark = true;
            }
          },
          toggle: () => {
            if (instance.$vuetify.theme.dark) {
              instance.$theme.light();
            } else {
              instance.$theme.dark();
            }
          },
        });

        if (load) {
          instance.$theme.load();
        }
      },
    };
  },
};
