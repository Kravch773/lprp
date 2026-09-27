// Плагін "Онлайн UA" для Lampa — українські джерела відео
(function () {
    'use strict';

    var mod_version = '1.0';

    /////////////////////////// Utils ///////////////////////////

    function startsWith(str, s) { return str.lastIndexOf(s, 0) === 0; }
    function endsWith(str, s) { var p = str.length - s.length; return p < 0 ? false : str.indexOf(s, p) === p; }

    function parseURL(link) {
        var url = { protocol: '', host: '', origin: '', pathname: '' };
        var pos = link.indexOf(':'), path_pos = link.indexOf('/');
        if (pos !== -1 && (path_pos === -1 || path_pos > pos)) {
            url.protocol = link.substring(0, pos + 1);
            link = link.substring(pos + 1);
        }
        if (startsWith(link, '//')) {
            pos = link.indexOf('/', 2);
            url.host = pos !== -1 ? link.substring(2, pos) : link.substring(2);
            link = pos !== -1 ? link.substring(pos) : '/';
            url.origin = url.protocol + '//' + url.host;
        }
        url.pathname = link;
        return url;
    }

    function fixLink(link, referrer) {
        if (!link || !referrer || link.indexOf('://') !== -1) return link || '';
        var url = parseURL(referrer);
        if (startsWith(link, '//')) return url.protocol + link;
        if (startsWith(link, '/')) return url.origin + link;
        var base = (url.origin + url.pathname);
        base = base.substring(0, base.lastIndexOf('/') + 1);
        return base + link;
    }

    function errorDecode(a, c) {
        var text = '';
        try { text = (a && a.statusText) || c || ''; } catch (e) {}
        return 'Помилка: ' + text;
    }

    ////////////////////// Джерело (фабрика DLE-сайтів) //////////////////////

    var CFG = {
        uakino: {
            title: 'UAKino',
            host: 'https://uakino.site/',                 // АДАПТУЙТЕ при зміні дзеркала
            search: 'index.php?do=search',               // POST-пошук DLE
            link_test: /\/(films|filmys|serialy|serials|multfilmy|mult|cartoons|anime)\//i
        },
        timetowatch: {
            title: 'TimeToWatch',
            host: 'https://time-to-watch.net/',           // АДАПТУЙТЕ при зміні дзеркала
            search: 'index.php?do=search',
            link_test: /\/(filmys|filmi|serialy|multfilmy|mult|cartoons|anime|tv)\//i
        },
        gurul: {
            title: 'Gurul',
            host: 'https://gurul.in/',                    // АДАПТУЙТЕ при зміні дзеркала
            search: 'index.php?do=search',
            link_test: /\/(filmys|serialy|multfilmy|mult|cartoons|anime)\//i
        }
    };

    function uaSite(component, _object, cfg) {
        var network = new Lampa.Reguest();
        var voices = [];                 // [{title, episodes:[{title, items:[{label,quality,file}]}]}]
        var object = _object;
        var select_title = '';

        function absolut(link) { return fixLink(link, cfg.host); }

        // TODO: якщо введена перевірка сертифікатів не спрацює — додайте сюди проксі cors за зразком
        function get(url, call) {
            network.clear();
            network.timeout(20000);
            network.native(url, call, function (a, c) {
                component.empty(errorDecode(a, c));
            }, false, { dataType: 'text' });
        }

        // --- розбір сторінки результатів пошуку (АДАПТАЦІЯ селекторів якщо потрібно) ---
        function parseSearch(str) {
            var res = [];
            try {
                var body = $('<div>' + (str || '') + '</div>');
                $('a[href]', body).each(function () {
                    var link = $(this).attr('href') || '';
                    var text = ($(this).text() || '').trim();
                    if (link && text && text.length > 1 && cfg.link_test.test(link)) {
                        link = absolut(link);
                        if (res.indexOf(null) === -1 && !res.some(function (i) { return i.link === link; })) {
                            var year = (text.match(/\((\d{4})\)/) || [])[1];
                            res.push({
                                title: text.replace(/\s*[\(\[]\d{4}[\)\]]\s*$/, '').trim(),
                                year: year ? parseInt(year) : 0,
                                link: link,
                                is_similars: false
                            });
                        }
                    }
                });
            } catch (e) {}
            return res;
        }

        // --- універсальний парсинг плеєра ---
        function parsePlayer(str, url) {
            str = (str || '').replace(/\n/g, '');

            // 1) Playerjs({file: ...}) або makePlayer({file: ...})
            var found = str.match(/Playerjs\(({.*?})\);/) || str.match(/makePlayer\(({.*?})\);/);
            var json;
            try { json = found && (0, eval)('"use strict"; (' + found[1] + ');'); } catch (e) {}

            if (json && json.file) { success(json, url); return true; }

            // 2) <iframe src="...">
            var fr = str.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (fr) {
                var fr_url = fixLink(fr[1], url);
                get(fr_url, function (s2) { parsePlayer(s2, fr_url); });
                return true;
            }
            return false;
        }

        // --- [240p]http://... or http://... (з варіантами озвучок) ---
        function parseItems(str) {
            var out = [];
            component.parsePlaylist(str || '').forEach(function (el) {
                var q = el.label.match(/(\d\d\d+)/);
                out.push({
                    label: (el.voice ? el.voice + ' - ' : '') + el.label,
                    quality: q ? parseInt(q[1]) : NaN,
                    file: el.links[0] || ''
                });
            });
            out.sort(function (a, b) { return (b.quality || 0) - (a.quality || 0); });
            return out;
        }

        function normalize(file) {
            var list = [];
            if (typeof file === 'string') {
                list.push({ title: '', episodes: [{ title: '', items: parseItems(file) }] });
            } else if (file && file.forEach) {
                file.forEach(function (v) {
                    var title = v.title || v.comment || '';
                    if (v.folder && v.folder.forEach) {
                        var episodes = [];
                        v.folder.forEach(function (e) {
                            var e_title = e.title || e.comment || '';
                            if (e.folder && e.folder.forEach) {
                                e.folder.forEach(function (e2) {
                                    episodes.push({ title: e_title + (e2.title ? ' ' + e2.title : ''), items: parseItems(e2.file || '') });
                                });
                            } else {
                                episodes.push({ title: e_title, items: parseItems(e.file || '') });
                            }
                        });
                        if (episodes.length) list.push({ title: title, episodes: episodes });
                    } else if (v.file) {
                        list.push({ title: title, episodes: [{ title: '', items: parseItems(v.file) }] });
                    }
                });
            }
            return list.filter(function (v) { return v.episodes.length && v.episodes.some(function (e) { return e.items.length; }); });
        }

        function success(json, url) {
            component.loading(false);
            voices = normalize(json.file);

            if (json.subtitle || (json.tracks && json.subtitle))
            { /* субтитри: за потреби додайте component.processSubs(json.subtitle) */ }

            if (voices.length) {
                vo.filter();
                vo.append(vo.filtred());
            } else component.empty_for_query(select_title);
        }

        function getPage(url) {
            get(url, function (str) {
                if (!parsePlayer(str, url)) component.empty_for_query(select_title);
            });
        }

        var vo = this; // хак для доступу до хвостових методів

        this.search = function (_object, kinopoisk_id, data) {
            var _this = this;
            object = _object;
            select_title = object.search || object.movie.title;
            if (this.wait_similars && data && data[0] && data[0].is_similars) return getPage(data[0].link);

            var search_date = object.search_date || object.movie.release_date || object.movie.first_air_date || '0000';
            var search_year = parseInt((search_date + '').slice(0, 4));

            var postdata = 'do=search&subaction=search&story=' + encodeURIComponent(component.clean_title(select_title));

            network.clear();
            network.timeout(20000);
            network.native(cfg.host + cfg.search, function (str) {
                var items = parseSearch(str);
                var cards = items;
                var is_sure = false;

                if (cards.length && select_title) {
                    var tmp = cards.filter(function (c) { return component.contains_title(c.title, select_title); });
                    if (tmp.length) { cards = tmp; is_sure = true; }
                }
                if (cards.length > 1 && search_year) {
                    var tmp2 = cards.filter(function (c) { return c.year == search_year; });
                    if (!tmp2.length) tmp2 = cards.filter(function (c) { return c.year && c.year > search_year - 2 && c.year < search_year + 2; });
                    if (tmp2.length) cards = tmp2;
                }

                if (cards.length === 1 && is_sure) getPage(cards[0].link);
                else if (items.length) {
                    _this.wait_similars = true;
                    items.forEach(function (c) { c.is_similars = true; });
                    component.similars(items);
                    component.loading(false);
                } else component.empty_for_query(select_title);
            }, function (a, c) {
                component.empty(errorDecode(a, c));
            }, postdata, { dataType: 'text' });
        };

        this.extend_choice = function (saved) {};
        this.get_choice = function () { return { season: 0 }; };
        this.set_choice = function (a, b) { component.save_choice(); };

        this.destroy = function () { network.clear(); voices = null; };

        this.filter = builder;
        // нижче — методи які викликаються з компонента через фільтр

        this.filter = function () {
            var filter_items = { quality: [], voice: voices.map(function (v, i) { return v.title || 'Плеєр ' + (i + 1); }) };
            component.filter(filter_items, { quality: 0, voice: 0 });
        };

        this.filtred = function () {
            var sel_voice = Lampa.Storage.get('ua_online_voice_' + cfg.title, 0) || 0;
            var voice = voices[sel_voice] || voices[0] || { episodes: [] };
            var out = [];
            voice.episodes.forEach(function (e, i) {
                if (!e.items.length) return;
                var s_m = (voice.title || '').match(/(\d+)/);
                var season = /сезон|season/i.test(voice.title || '') && s_m ? parseInt(s_m[1]) : NaN;
                var e_m = (e.title || '').match(/(\d+)/);
                var episode = e_m ? parseInt(e_m[1]) : NaN;
                if (!season) season = null;
                if (!episode) episode = isNaN(episode) ? i + 1 : episode;
                out.push({
                    title: e.title || (voice.title || select_title),
                    quality: e.items[0] ? e.items[0].label : '',
                    info: voice.title ? ' / ' + Lampa.Utils.shortText(voice.title, 50) : '',
                    season: season,
                    episode: episode,
                    media: { items: e.items }
                });
            });
            return out;
        };
    }

    /////////////////////////// Component ///////////////////////////

    function component(object) {
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);
        var balanser = Lampa.Storage.get('ua_online_balanser', 'uakino') + '';
        var extended = false;
        var self = this;

        var sources =CFG;
        var all_src = {};
        Object.keys(CFG).forEach(function (k) { all_src[k] = new uaSite(self, object, CFG[k]); });
        var names = Object.keys(CFG);
        if (names.indexOf(balanser) == -1) { balanser = names[0]; Lampa.Storage.set('ua_online_balanser', balanser); }

        // локальні утиліти
        this.parse_playlist = function (str) {
            // [360p]http://... or ... (може містити {..} озвучки)
            var pl = [];
            try {
                if (startsWith(str, '[')) {
                    str.substring(1).split(/, *\[/).forEach(function (item) {
                        item = item.trim();
                        if (endsWith(item, ',')) item = item.substring(0, item.length - 1).trim();
                        var le = item.indexOf(']');
                        if (le >= 0) {
                            var label = item.substring(0, le).trim();
                            if (item.charAt(le + 1) === '{') {
                                item.substring(le + 2).split(/; *\{/).forEach(function (v_item) {
                                    v_item = v_item.trim();
                                    if (endsWith(v_item, ';')) v_item = v_item.substring(0, v_item.length - 1).trim();
                                    var ve = v_item.indexOf('}');
                                    if (ve >= 0) {
                                        var voice = v_item.substring(0, ve).trim();
                                        pl.push({
                                            label: label, voice: voice,
                                            links: v_item.substring(ve + 1).split(' or ').map(function (l) { return l.trim(); }).filter(String)
                                        });
                                    }
                                });
                            } else {
                                pl.push({
                                    label: label,
                                    links: item.substring(le + 1).split(' or ').map(function (l) { return l.trim(); }).filter(String)
                                });
                            }
                        }
                    });
                }
            } catch (e) {}
            return pl;
        };

        this.clean_title = function (str) { return (str || '').replace(/[\s.,:;’'`!?]+/g, ' ').trim(); };
        this.normalize_title = function (str) { return this.clean_title((str || '').toLowerCase().replace(/[\-–—]+/g, '-')); };
        this.equal_title = function (a, b) { return typeof a === 'string' && typeof b === 'string' && this.normalize_title(a) === this.normalize_title(b); };
        this.contains_title = function (a, b) { return typeof a === 'string' && typeof b === 'string' && this.normalize_title(a).indexOf(this.normalize_title(b)) !== -1; };
        this.save_choice = function () { Lampa.Storage.set('ua_online_voice_' + CFG[balanser].title, Lampa.Storage.get('ua_online_voice_' + CFG[balanser].title, 0)); };
        this.get_last_episode = function (items) {
            var last = 0;
            items.forEach(function (e) { if (typeof e.episode !== 'undefined') last = Math.max(last, parseInt(e.episode) || 0); });
            return last || (items.length ? items[items.length - 1].episode || 0 : 0);
        };

        this.append = function (item) {
            item.on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
            scroll.append(item);
        };

        this.similars = function (items) {
            var _this = this;
            items.forEach(function (elem) {
                var year = elem.year || '';
                elem.quality = year ? ('' + year) : '----';
                elem.info = '';
                var item = Lampa.Template.get('ua_online_folder', elem);
                item.on('hover:enter', function () {
                    _this.reset();
                    all_src[balanser].search(object, null, [elem]);
                });
                _this.append(item);
            });
        };

        this.reset = function () { scroll.clear(); scroll.reset(); };
        this.empty = function (msg) {
            var empty = Lampa.Template.get('list_empty');
            if (msg) empty.find('.empty__descr').text(msg);
            scroll.append(empty);
            this.loading(false);
        };
        this.empty_for_query = function (q) {
            this.empty('За запитом (' + q + ') немає результатів');
        };
        this.loading = function (status) {
            if (status) this.activity.loader(true);
            else {
                this.activity.loader(false);
                if (Lampa.Activity.active().activity === this.activity) this.activity.toggle();
            }
        };

        // ---- фільтр ----
        this.filter = function (items, choice) {
            var filter_items = [Lampa.Lang.translate('torrent_parser_voice')];
            var select = [{ title: Lampa.Lang.translate('torrent_parser_reset'), reset: true }];
            if (items.voice && items.voice.length) {
                var stored = parseInt(Lampa.Storage.get('ua_online_voice_' + CFG[balanser].title, 0));
                if (isNaN(stored) || stored >= items.voice.length) stored = 0;
                select.push({
                    title: Lampa.Lang.translate('online_ua_source2') + ': ' + (items.voice[stored] || ''),
                    stype: 'voice',
                    items: items.voice.map(function (name, i) {
                        return { title: name || ('Плеєр ' + (i + 1)), selected: i === stored };
                    })
                });
            }
            select.push({
                title: Lampa.Lang.translate('online_ua_source') + ': ' + CFG[balanser].title,
                stype: 'source',
                items: names.map(function (n) { return { title: CFG[n].title, selected: n === balanser }; })
            });
            filter.set('filter', select);
            filter.set('sort', names.map(function (n) {
                return { title: CFG[n].title, selected: n === balanser, source: n };
            }));
            this.selected(items);
        };

        this.selected = function (items) {
            filter.chosen('filter', []);
            filter.chosen('sort', [CFG[balanser].title]);
        };

        // ---- картки ----
        this.contextmenu = function (params) {
            params.item.on('hover:long', function () {
                var enabled = Lampa.Controller.enabled().name;
                Lampa.Select.show({
                    title: Lampa.Lang.translate('title_action'),
                    items: [
                        { title: Lampa.Lang.translate('torrent_parser_label_title'), mark: true },
                        { title: Lampa.Lang.translate('torrent_parser_label_cancel_title'), clearmark: true },
                        { title: Lampa.Lang.translate('time_reset'), timeclear: true },
                        { title: Lampa.Lang.translate('copy_link'), copylink: true }
                    ],
                    onBack: function () { Lampa.Controller.toggle(enabled); },
                    onSelect: function (a) {
                        if (a.clearmark) {
                            Lampa.Arrays.remove(params.viewed, params.hash_file);
                            Lampa.Storage.set('online_view', params.viewed);
                            params.item.find('.torrent-item__viewed').remove();
                        }
                        if (a.mark && params.viewed.indexOf(params.hash_file) == -1) {
                            params.viewed.push(params.hash_file);
                            params.item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                            Lampa.Storage.set('online_view', params.viewed);
                        }
                        if (a.timeclear) {
                            params.view.percent = 0; params.view.time = 0; params.view.duration = 0;
                            Lampa.Timeline.update(params.view);
                        }
                        Lampa.Controller.toggle(enabled);
                        if (a.copylink && params.file) {
                            params.file(function (extra) {
                                Lampa.Utils.copyTextToClipboard(extra.file || '', function () {
                                    Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
                                }, function () { Lampa.Noty.show(Lampa.Lang.translate('copy_error')); });
                            });
                        }
                    }
                });
            });
        };

        this.render = function () { return files.render(); };
        this.back = function () { Lampa.Activity.backward(); };
        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {
            network.clear();
            files.destroy();
            scroll.destroy();
            Object.keys(all_src).forEach(function (k) { all_src[k].destroy(); });
        };

        filter.onSearch = function (value) {
            Lampa.Activity.replace({ search: value, search_date: '', clarification: true });
        };
        filter.onBack = this.back;
        filter.onSelect = function (type, a, b) {
            if (type == 'filter') {
                if (a.reset) { self.find(); return; }
                if (a.stype == 'source') self.change_source(b.title);
                else if (a.stype == 'voice') {
                    var titles = names;
                    Lampa.Storage.set('ua_online_voice_' + CFG[balanser].title, a.items ? a.items.indexOf(b) : b.index);
                    self.append(self.filtred());
                }
            } else if (type == 'sort') self.change_source(a.source);
        };

        this.change_source = function (name) {
            var new_balanser = names.filter(function (n) { return CFG[n].title === name; })[0] || name;
            if (new_balanser !== balanser) {
                balanser = new_balanser;
                Lampa.Storage.set('ua_online_balanser', balanser);
            }
            self.find();
            setTimeout(function () { Lampa.Select.close(); }, 10);
        };

        this.find = function () {
            this.activity.loader(true);
            this.reset();
            this.filter({ voice: [] }, {});
            var prev = Lampa.Storage.get('ua_online_voice_' + CFG[balanser].title, 0);
            all_src[balanser].search(object, null, null);
        };

        this.start = function (first_select) {
            if (Lampa.Activity.active().activity !== this.activity) return;
            if (first_select) last = scroll.render().find('.selector').eq(0)[0];
            Lampa.Background.immediately(Lampa.Utils.cardImgBackground(object.movie));
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function () { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down:
