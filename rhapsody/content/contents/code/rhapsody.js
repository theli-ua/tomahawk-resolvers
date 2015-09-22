/* http://music.163.com resolver for Tomahawk.
 *
 * Written in 2015 by Anton Romanov
 * Licensed under the Eiffel Forum License 2.
 *
 */

var api_to_extend = Tomahawk.Resolver.Promise; //Old 0.9
if(typeof api_to_extend === 'undefined')
    api_to_extend = Tomahawk.Resolver; //New 0.9

var RhapsodyResolver = Tomahawk.extend( api_to_extend, {
    apiVersion: 0.9,

    logged_in: null, // null, = not yet tried, 0 = pending, 1 = success, 2 = failed
    numQuality: [64, 192, 320],
    API_KEY: 'ZTJlOWNhZGUtNzlmZS00ZGU2LTkwYjMtZDk1ODRlMDkwODM5',
    DEV_KEY: '8I1E4E1C2G5F1I8F',
    AUTH   : 'Basic c2VjdXJlX21vYmlsZV9hbmRyb2lkOk5qZzJPVEl3Tm1RMlpqWmxObUl5TURZMk5tTTNPVEl3TnpNMk9EWm1OalU9',

    settings: {
        cacheTime: 300,
        name: 'Rhapsody',
        weight: 90,
        icon: '../images/logo.png',
        timeout: 15
    },

    getConfigUi: function () {
        return {
            "widget": Tomahawk.readBase64("config.ui"),
            fields: [{
                name: "email",
                widget: "email_edit",
                property: "text"
            }, {
                name: "password",
                widget: "password_edit",
                property: "text"
            }, {
                name: "quality",
                widget: "quality",
                property: "currentIndex"
            }]
        };
    },

    newConfigSaved: function (newConfig) {
        var changed =
            this._email !== newConfig.email ||
            this._password !== newConfig.password ||
            this._quality != newConfig.quality;

        if (changed) {
            this.init();
        }
    },

    testConfig: function (config) {
        return this._getLoginPromise(config).then(function () {
            return Tomahawk.ConfigTestResultType.Success;
        }, function (xhr) {
            if (xhr.status == 401) {
                return Tomahawk.ConfigTestResultType.InvalidCredentials;
            } else {
                return Tomahawk.ConfigTestResultType.CommunicationError;
            }
        });
    },

    _convertTrack: function (entry) {
        return {
            artist:     entry.artist.name,
            album:      entry.album.name,
            track:      entry.name,
            title:      entry.name,
            bitrate:    this.numQuality[this._quality],
            duration:   entry.duration,
            url:        'rhap://track/' + entry.id,
            checked:    true,
            type:       "track"
        };
    },

    init: function() {
        //Needed for old 0.9
        Tomahawk.addCustomUrlHandler( 'rhap', 'getStreamUrl', true );

        var config = this.getUserConfig();

        this._email = config.email;
        this._password = config.password;
        this._quality = config.quality;

        if (!this._email || !this._password) {
            Tomahawk.reportCapabilities(TomahawkResolverCapability.NullCapability);
            //This is being called even for disabled ones
            //throw new Error( "Invalid configuration." );
            Tomahawk.log("Invalid Configuration");
            return;
        }

        Tomahawk.reportCapabilities(TomahawkResolverCapability.UrlLookup);

        this._login(config);
    },

    _getSession: function() {
        var that = this;
        if (this._session) {
            return Promise.resolve(this._session);
        } else {
            var headers = {
                'x-rhapsody-access-token' : that._rhap_config.data.rhapsodyAccessToken,
                'Authorization'           : that.AUTH,
                'x-rds-devkey'            : that.DEV_KEY,
                'Origin' : 'https://playback.rhapsody.com',
                'Accept' : 'application/json',
            };
            return Tomahawk.post('https://secure-direct-auth.rhapsody.com/playbackserver/v1/users/' +
                    that._rhap_config.data.userGuid + '/sessions', {data : {clientType:'mobile_android_5_0_3'},
                        headers: headers, dataFormat: 'json'}).then(function(resp) {
                            Tomahawk.log(JSON.stringify(resp));
                            that._session = resp;
                            return resp;
                    });
        }
    },

    getStreamUrl: function(qid, url) {
        var newAPI = false;
        Tomahawk.log(qid);
        Tomahawk.log(url);
        if(qid.url) {
            //new 0.9
            url = qid.url;
            newAPI = true;
        }
        var that = this;
        var id = url.match(/^rhap:\/\/([a-z]+)\/(.+)$/);
        if(!id ) {
            if(newAPI) {
                return {url:url};
            } else {
                Tomahawk.reportStreamUrl(qid, url);
            }
        }
        id = id[2];

            var headers = {
                'x-rhapsody-access-token' : that._rhap_config.data.rhapsodyAccessToken,
                'Authorization'           : that.AUTH,
                'x-rds-devkey'            : that.DEV_KEY,
                'Origin' : 'https://playback.rhapsody.com',
                'Accept' : 'application/json',
            };

        return this._getSession().then(function(session) {
            return Tomahawk.get('https://secure-direct-auth.rhapsody.com/playbackserver/v1/users/' +
                    that._rhap_config.data.userGuid + '/sessions/' + session.id + '/track/' + id +
                    '/status?context=ON_DEMAND&deviceid=358239053401768', {headers:headers}).then(function(){
            return Tomahawk.get('http://direct-ns.rhapsody.com/metadata/data/methods/getTracks.xml', {
                    headers: {
                        cobrandId: that._rhap_config.data.cocat,
                        guid: that._rhap_config.data.userGuid,
                        clientType: 'mobile_android_5_0_3'
                    },
                    data : {
                        developerKey: that.DEV_KEY,
                        cobrandId: that._rhap_config.data.cocat,
                        filterRightsKey: 2,
                        trackIds: id
                    }
                }).then(function(track) {
                    var medias = track.getElementsByTagName('LiteTrackPlaybackInfo');
                    var currentRate = 0;
                    for(var i = 0; i < medias.length; ++i){
                        var newUrl = medias[i].getElementsByTagName("mediaUrl")[0].textContent; 
                        var bitrate = parseInt(medias[i].getElementsByTagName("bitRate")[0].textContent);
                        if (bitrate >= currentRate) {
                            url = newUrl;
                            currentRate = bitrate;
                        }
                        if (currentRate == that.numQuality[that._quality]) {
                            break;
                        }
                    };
                    var ts = Math.floor(Date.now() / 1000);
                    url = url + '?e=' + ts;
                    var hash = CryptoJS.MD5('ekh6d62bbwhe' + url).toString();
                    url = url + '&h=' + hash;
                    Tomahawk.log(url);
                    if(newAPI) {
                        return {url:url};
                    } else {
                        Tomahawk.reportStreamUrl(qid, url);
                    }
                });
                    });
        });
    },

    _apiCall: function(endpoint, params) {
        return Tomahawk.post(this.API_BASE + endpoint, {data: params, headers: {
            'Referer' : this.API_BASE
        }});
    },

    search: function (query) {
        if (!this.logged_in) {
            return this._defer(this.search, [query], this);
        } else if (this.logged_in === 2) {
            throw new Error('Failed login, cannot search.');
        }

        var that = this;

        if(query.hasOwnProperty('query'))
            query = query.query; //New 0.9

        return Tomahawk.get('http://api.rhapsody.com/v1/search/typeahead', {
                data : {
                   type: 'track',
                   limit: '10',
                   offset: '0',
                   apikey: that.API_KEY,
                   catalog: that._rhap_config.data.country,
                   q: query
                }
                }).then(function(results) {
                    return results.map(that._convertTrack, that);
                });
    },

    resolve: function (artist, album, track) {
        if(artist.hasOwnProperty('artist'))
        {
            //New 0.9
            album = artist.album;
            track = artist.track;
            artist = artist.artist;
        }
        var query = [ artist, track ].join(' ');
        return this.search({query:query});
    },

    _defer: function (callback, args, scope) {
        if (typeof this._loginPromise !== 'undefined' && 'then' in this._loginPromise) {
            args = args || [];
            scope = scope || this;
            Tomahawk.log('Deferring action with ' + args.length + ' arguments.');
            return this._loginPromise.then(function () {
                Tomahawk.log('Performing deferred action with ' + args.length + ' arguments.');
                callback.call(scope, args);
            });
        }
    },

    _getLoginPromise: function (config) {
        var that = this;

        return Tomahawk.post('https://playback.rhapsody.com/login.json',{
                data : {
                    'password' : config.password, 
                    'username' : config.email, 
                }
        });
    },

    _login: function (config) {
        // If a login is already in progress don't start another!
        if (this.logged_in === 0) {
            return;
        }
        this.logged_in = 0;

        var that = this;

        this._loginPromise = this._getLoginPromise(config)
            .then(function (resp) {
                Tomahawk.log(that.settings.name + " successfully logged in.");
                if (!resp.data) {
                    resp = JSON.parse(resp);
                }

                that._rhap_config = resp;

                that.logged_in = 1;
            }, function (error) {
                Tomahawk.log(that.settings.name + " failed login.");

                delete that._rhap_config;

                that.logged_in = 2;
            }
        );
        return this._loginPromise;
    }
});

Tomahawk.resolver.instance = RhapsodyResolver;


