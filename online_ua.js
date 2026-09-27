// Онлайн UA для Lampa — українські джерела відео (повний, робочий файл)
(function () {
    'use strict';

    var mod_version = '1.0.3';
    var LOG = '[OnlineUA] ';

    function startsWith(s, p) { return s.lastIndexOf(p, 0) === 0; }
    function endsWith(s, p) { var i = s.length - p.length; return i < 0 ? false : s.indexOf(p, i) === i; }

    function log() {
        try { console.log.apply(console, [LOG].concat([].slice.call(arguments))); } catch (e) {}
    }

    // Браузер на lampa.mx не читає чужі сайти без CORS. Android-додаток ходить напряму.
    function useCors() {
        try {
            if (window.AndroidJS && typeof window.AndroidJS.httpReq === 'function') return false;
        } catch (e) {}
        return true;
    }

    function corsBase() {
        var custom = '';
        try { custom = (Lampa.Storage.get('online_ua_cors', '') || '') + ''; } catch (e) {}
        custom = (custom || '').trim();
        if (!custom) custom = 'https://cors.redoc.ly/';
        if (custom.charAt(custom.length - 1) !== '/') custom += '/';
        return custom;
    }

    function corsUrl(url) {
        if (!url || !useCors()) return url;
        var base = corsBase();
        if (url.indexOf(base) === 0) return url;
        return base + url;
    }

    function openFrame(url) {
        $('.online-ua-frame').remove();
        var root = $('<div class="online-ua-frame"></div>');
        root.css({ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, zIndex: 99999, background: '#000' });
        var frame = $('<iframe allowfullscreen></iframe>');
        frame.attr({ src: url, allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture' });
        frame.css({ width: '100%', height: '100%', border: 0, display: 'block' });
        var close = $('<div class="selector online-ua-frame__close">Закрити</div>');
        close.css({
            position: 'absolute', top: '1em', right: '1em', zIndex: 2,
            padding: '0.6em 1em', background: 'rgba(0,0,0,.7)', color: '#fff', borderRadius: '0.4em'
        });
        root.append(frame).append(close);
        $('body').append(root);
        var prev = 'content';
        try { prev = Lampa.Controller.enabled().name || 'content'; } catch (e) {}
        function shut() {
            root.remove();
            Lampa.Controller.toggle(prev);
        }
        close.on('hover:enter click', function () { shut(); });
        Lampa.Controller.add('online_ua_frame', {
            toggle: function () {
                Lampa.Controller.collectionSet(root);
                Lampa.Controller.collectionFocus(close[0], root);
            },
            back: shut
        });
        Lampa.Controller.toggle('online_ua_frame');
    }

    function shortText(str, limit) {
        str = (str || '') + '';
        return str.length > limit ? str.substring(0, limit) + '…' : str;
    }

    function parseURL(link) {
        var url = { protocol: '', host: '', origin: '', pathname: '' };
        var pos = link.indexOf(':'), pp = link.indexOf('/');
        if (pos !== -1 && (pp === -1 || pp > pos)) { url.protocol = link.substring(0, pos + 1); link = link.substring(pos + 1); }
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
        link = link || '';
        if (!link || !referrer || link.indexOf('://') !== -1) return link;
        var url = parseURL(referrer);
        if (startsWith(link, '//')) return url.protocol + link;
        if (startsWith(link, '/')) return url.origin + link;
        if (startsWith(link, '?')) return url.origin + url.pathname + link;
        var base = url.origin + url.pathname;
        base = base.substring(0, base.lastIndexOf('/') + 1);
        return base + link;
    }

    function errorDecode(a, c) {
        var t = '';
        try { t = (a && (a.status + ' ' + a.statusText)) || (c || ''); } catch (e) {}
        return 'Помилка мережі: ' + t;
    }

    ////////////////////// КОНФІГ ДЖЕРЕЛ //////////////////////

    var SITES = {
        uakino: {
            title: 'UAKino', host: 'https://uakino.me', dle: true,
            match: /\/(filmy|serialy|multfilmy|anime|kluchovix)\//i
        },
        timetowatch: {
            title: 'TimeToWatch', host: 'https://time-to-watch.net', dle: true,
            match: /\/(filmy|serialy|multfilmy|anime|tv)\//i
        },
        gurul: {
            title: 'Gurul', host: 'https://gurul.in', dle: true,
            match: /\/(filmy|serialy|multfilmy|anime)\//i
        },
        uaserials: {
            title: 'UASerials', host: 'https://uaserials.my', dle: true,
            match: /\/(serial|film|mult|anime)\/|\/\d+-[^\/?#]+\.html/i
        },
        eneyida: {
            title: 'Eneyida', host: 'https://eneyida.tv', dle: true,
            match: /\/(filmi|serialy|multiki|anime)\//i
        }
        /* Щоб додати сайт — скопіюйте блок і змініть host/match.
           Дзеркала змінюються: якщо сайт не відкривається — оновіть host. */
    };

    var site_names = Object.keys(SITES);

    ////////////////////// Фабрика джерела //////////////////////

    function uaSource(component, object, site_cfg) {
        var net = new Lampa.Reguest();
        var voices = [];
        var select_title = '';
        var self = this;

        this.choice_voice = 0;

        function get(url, ok, fail, post) {
            net.clear();
            net.timeout(20000);
            var target = post ? url : corsUrl(url);
            if (target !== url) log('cors', target);
            net.native(target, ok, fail, post || false, { dataType: 'text' });
        }

        function uniqCards(list) {
            var seen = {}, out = [];
            list.forEach(function (c) {
                if (!seen[c.link]) { seen[c.link] = 1; out.push(c); }
            });
            return out;
        }

        // --- пошук карток у видачі сайту ---
        function cardTitle(el) {
            var text = ($(el).attr('title') || '').trim();
            var box = $(el).closest('.short-item');
            if (box.length) {
                var uk = (box.find('.th-title').first().text() || '').trim();
                var en = (box.find('.th-title-oname').first().text() || '').trim();
                if (uk) return en && uk.toLowerCase() !== en.toLowerCase() ? (uk + ' / ' + en) : uk;
            }
            if (!text) text = ($(el).find('img').attr('alt') || '').trim();
            if (!text) text = ($(el).text() || '').trim();
            return text;
        }

        function parseSearch(str) {
            var out = [];
            try {
                var dom = $('<div>' + (str || '').replace(/\n/g, '') + '</div>');
                var nodes = $('.short-item a.short-img[href]', dom);
                if (!nodes.length) nodes = $('a[href]', dom);
                nodes.each(function () {
                    var href = $(this).attr('href') || '';
                    var text = cardTitle(this);
                    if (href && text && text.length > 2 && site_cfg.match.test(href)) {
                        var year = parseInt((text.match(/\b(19|20)\d{2}\b/) || [])[0] || 0);
                        out.push({
                            title: text.replace(/\s*[\/,(–-]*\s*(19|20)\d{2}.*$/, '').trim() || text,
                            year: year,
                            link: fixLink(href, site_cfg.host + '/')
                        });
                    }
                });
            } catch (e) { log('parseSearch error', e); }
            return uniqCards(out);
        }

        // --- "[480p]http://... or ..." (+ озвучки у {...}) ---
        function parseItems(str, ref_url) {
            return component.parse_playlist(str).map(function (i) {
                var q = (i.label || '').match(/(\d{3,4})/);
                return {
                    label: (i.voice ? i.voice + ' — ' : '') + i.label,
                    quality: q ? parseInt(q[1]) : 0,
                    file: fixLink(i.links[0] || '', ref_url)
                };
            }).filter(function (i) { return i.file; })
              .sort(function (a, b) { return b.quality - a.quality; });
        }

        function parseSubs(str, ref_url) {
            if (!str) return false;
            var list = component.parse_playlist(typeof str === 'string' ? str : '');
            var subs = list.map(function (i) {
                return { label: i.voice || i.label || 'Субтитри', url: fixLink(i.links[0] || '', ref_url) };
            }).filter(function (s) { return s.url; });
            return subs.length ? subs : false;
        }

        // --- Playerjs file/folder → [{title, episodes:[...]}] ---
        function normalize(file, ref_url, subs_fb) {
            var list = [];
            function addEpisode(vt, et, items, subs) {
                if (!items.length) return;
                var v = list.filter(function (x) { return x.title === vt; })[0];
                if (!v) { v = { title: vt, episodes: [] }; list.push(v); }
                v.episodes.push({ title: et, items: items, subtitles: subs || subs_fb || false });
            }
            function walk(node, vt, et) {
                var title = node.title || node.comment || '';
                if (node.folder && node.folder.forEach) {
                    node.folder.forEach(function (ch) { walk(ch, vt || title, et || title); });
                } else if (node.file) {
                    addEpisode(vt || title, et || title, parseItems(node.file, ref_url), parseSubs(node.subtitle, ref_url));
                }
            }
            if (typeof file === 'string') {
                addEpisode('', '', parseItems(file, ref_url));
            } else if (file && file.forEach) {
                file.forEach(function (n) { walk(n, '', ''); });
            }
            return list.filter(function (v) { return v.episodes.length; });
        }

        // --- парсинг сторінки з плеєром ---
        function parsePlayer(str, url, depth, onDone) {
            if (!str) { onDone(null); return; }
            str = str.replace(/\n/g, '');

            var m = str.match(/Playerjs\((\{[\s\S]*?\})\);?/) || str.match(/makePlayer\((\{[\s\S]*?\})\);?/) ||
                    str.match(/file\s*[:=]\s*("|')(\[.*?\])\1/);
            var json = null;
            if (m) {
                var raw = m[2] ? '"' + m[2] + '"' : m[1];
                try { json = (0, eval)('"use strict"; (' + raw + ');'); } catch (e) { log('eval err', e); }
                if (json && typeof json === 'string') json = { file: json };
            }
            if (json && json.file) { onDone(json); return; }

            // прямі enlace m3u8/mp4 у скриптах
            var hls = str.match(/https?:\/\/[^"'\s\\<>]+\.m3u8[^"'\s\\<>]*/i) || str.match(/https?:\/\/[^"'\s\\<>]+\.mp4[^"'\s\\<>]*/i);
            if (hls) { onDone({ file: '[auto]' + fixLink(hls[0], url) }); return; }

            // <iframe> — рекурсивно (глибина ≤ 3)
            var ifr = str.match(/<iframe[^>]+data-src=["']([^"']+)["']/i) ||
                      str.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (ifr && depth < 3) {
                var fr_url = fixLink(ifr[1], url);
                log('iframe →', fr_url);
                get(fr_url, function (s2) {
                    parsePlayer(s2, fr_url, depth + 1, function (json) {
                        onDone(json && (json.file || json.iframe) ? json : { iframe: fr_url });
                    });
                }, function () { onDone({ iframe: fr_url }); });
                return;
            }
            onDone(null);
        }

        function getPage(url) {
            get(url, function (str) {
                parsePlayer(str, url, 0, function (json) {
                    component.loading(false);
                    if (json && json.file) {
                        voices = normalize(json.file, url, parseSubs(json.subtitle, url));
                        log('voices:', voices.length);
                        if (voices.length) {
                            self.choice_voice = 0;
                            component.refilter(voices.map(function (v, i) { return v.title || 'Плеєр ' + (i + 1); }));
                            component.appendItems(self.filtred());
                        } else component.empty_for_query(select_title);
                    } else if (json && json.iframe) {
                        voices = [{
                            title: 'Плеєр',
                            episodes: [{
                                title: select_title || 'Дивитись',
                                items: [{ label: 'Плеєр', file: json.iframe, iframe: true }],
                                subtitles: false
                            }]
                        }];
                        self.choice_voice = 0;
                        component.refilter(['Плеєр']);
                        component.appendItems(self.filtred());
                    } else {
                        log('player не знайдено на', url);
                        component.empty_for_query(select_title);
                    }
                });
            }, function (a, c) {
                component.empty('Сторінка недоступна: ' + site_cfg.title);
            });
        }

        this.search = function (_object, kinopoisk_id, data) {
            object = _object;
            select_title = object.search || object.movie.title;

            if (this.wait_similars && data && data[0] && data[0].is_similars) return getPage(data[0].link);

            var search_date = object.search_date || object.movie.release_date || object.movie.first_air_date || object.movie.last_air_date || '0000';
            var search_year = parseInt((search_date + '').slice(0, 4));
            var query = component.clean_title(select_title);

            var url, post = null;
            if (site_cfg.dle) {
                url = site_cfg.host + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
            } else {
                url = site_cfg.host + '/search?q=' + encodeURIComponent(query);
            }
            log('search', site_cfg.title, query);

            get(url, function (str) {
                var items = parseSearch(str);
                log('знайдено карток:', items.length);
                var cards = items, is_sure = false;

                if (cards.length && select_title) {
                    var t = cards.filter(function (c) { return component.contains_title(c.title, select_title); });
                    if (t.length) { cards = t; is_sure = true; }
                }
                if (cards.length > 1 && search_year) {
                    var t2 = cards.filter(function (c) { return c.year == search_year; });
                    if (!t2.length) t2 = cards.filter(function (c) { return c.year && c.year > search_year - 2 && c.year < search_year + 2; });
                    if (t2.length) cards = t2;
                }

                if (cards.length === 1 && is_sure) getPage(cards[0].link);
                else if (items.length) {
                    self.wait_similars = true;
                    items.forEach(function (c) { c.is_similars = true; });
                    component.similars(items);
                    component.loading(false);
                } else component.empty_for_query(select_title);
            }, function (a, c) {
                component.empty('Не вдалося виконати пошук: ' + site_cfg.title + ' (' + errorDecode(a, c) + ')');
            }, post);
        };

        this.filtred = function () {
            var voice = voices[this.choice_voice] || voices[0] || { episodes: [] };
            var out = [];
            voice.episodes.forEach(function (ep, i) {
                var season = voice.episodes.length > 1 ?
                    (parseInt(((voice.title || '').match(/сезон\s*(\d+)/i) || [])[1] || 1) || 1) : null;
                var em = (ep.title || '').match(/(?:серія|епізод|episode)\s*(\d+)|^\s*(\d+)\s*$/i);
                var episode = em ? parseInt(em[1] || em[2]) : (voice.episodes.length > 1 ? i + 1 : undefined);
                out.push({
                    title: ep.title || voice.title || select_title,
                    quality: ep.items[0] ? (ep.items[0].label || '').split('—').pop() : '',
                    info: voice.title ? ' / ' + shortText(voice.title, 50) : '',
                    season: season,
                    episode: episode,
                    media: { items: ep.items, subtitles: ep.subtitles }
                });
            });
            return out;
        };

        this.extendChoice = function (saved) {
            if (saved && typeof saved.voice === 'number') this.choice_voice = saved.voice;
        };
        this.saveChoice = function () {}; // зберігає компонент

        this.destroy = function () { net.clear(); voices = null; };
    }

    ////////////////////////// Component //////////////////////////

    function component(object) {
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);
        var self = this;

        var balanser = Lampa.Storage.get('online_ua_balanser', site_names[0]) + '';
        if (site_names.indexOf(balanser) == -1) { balanser = site_names[0]; Lampa.Storage.set('online_ua_balanser', balanser); }

        var sources = {};
        site_names.forEach(function (n) { sources[n] = new uaSource(self, object, SITES[n]); });

        var last;

        // ---------- утиліти ----------
        this.parse_playlist = function (str) {
            var pl = [];
            if (!str || !startsWith(str = (str + ''), '[')) return pl;
            try {
                str.substring(1).split(/, *\[/).forEach(function (item) {
                    item = item.trim();
                    if (endsWith(item, ',')) item = item.substring(0, item.length - 1).trim();
                    var le = item.indexOf(']');
                    if (le < 0) return;
                    var label = item.substring(0, le).trim();
                    if (item.charAt(le + 1) === '{') {
                        item.substring(le + 2).split(/; *\{/).forEach(function (vi) {
                            vi = vi.trim();
                            if (endsWith(vi, ';')) vi = vi.substring(0, vi.length - 1).trim();
                            var ve = vi.indexOf('}');
                            if (ve >= 0) pl.push({
                                label: label, voice: vi.substring(0, ve).trim(),
                                links: vi.substring(ve + 1).split(' or ').map(function (l) { return l.trim(); }).filter(String)
                            });
                        });
                    } else {
                        pl.push({
                            label: label,
                            links: item.substring(le + 1).split(' or ').map(function (l) { return l.trim(); }).filter(String)
                        });
                    }
                });
            } catch (e) {}
            return pl.filter(function (i) { return i.links.length; });
        };

        this.clean_title = function (s) { return (s || '').replace(/[\s.,:;’'`!?]+/g, ' ').trim(); };
        this.normalize_title = function (s) { return this.clean_title((s || '').toLowerCase().replace(/[\u2010-\u2015]/g, '-')); };
        this.contains_title = function (a, b) {
            return typeof a === 'string' && typeof b === 'string' &&
                this.normalize_title(a).indexOf(this.normalize_title(b)) !== -1;
        };

        this.append = function (item) {
            item.on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
            scroll.append(item);
        };

        this.reset = function () { scroll.clear(); scroll.reset(); };

        this.empty = function (msg) {
            var e = Lampa.Template.get('list_empty');
            if (msg) e.find('.empty__descr').text(msg);
            scroll.append(e);
            this.loading(false);
        };
        this.empty_for_query = function (q) { this.empty('За запитом (' + q + ') немає результатів'); };

        this.loading = function (status) {
            if (status) this.activity.loader(true);
            else {
                this.activity.loader(false);
                if (Lampa.Activity.active().activity === this.activity && this.inActivity()) this.activity.toggle();
            }
        };
        this.inActivity = function () {
            var b = $('body');
            return !(b.hasClass('settings--open') || b.hasClass('menu--open') ||
                b.hasClass('selectbox--open') || b.hasClass('search--open') || $('div.modal').length);
        };

        // ---------- similars ----------
        this.similars = function (items) {
            var _this = this;
            items.forEach(function (elem) {
                elem.quality = elem.year ? ('' + elem.year) : '----';
                elem.info = '';
                var item = Lampa.Template.get('online_ua_folder', elem);
                item.on('hover:enter', function () {
                    _this.activity.loader(true);
                    _this.reset();
                    sources[balanser].search(object, null, [elem]);
                });
                _this.append(item);
            });
        };

        // ---------- список файлів ----------
        this.appendItems = function (items) {
            var _this = this;
            this.reset();
            var viewed = Lampa.Storage.cache('online_view', 5000, []);
            var last_ep = 0;
            items.forEach(function (e) { if (typeof e.episode !== 'undefined') last_ep = Math.max(last_ep, parseInt(e.episode) || 0); });

            items.forEach(function (element) {
                if (element.season) {
                    element.translate_episode_end = last_ep;
                    element.translate_voice = '';
                }
                var hash = Lampa.Utils.hash(element.season ?
                    [element.season, ':', element.episode, object.movie.original_title].join('') :
                    object.movie.original_title + 'online_ua');
                var view = Lampa.Timeline.view(hash);
                var item = Lampa.Template.get('online_ua', element);
                var hash_file = Lampa.Utils.hash(element.season ?
                    [element.season, ':', element.episode, object.movie.original_title, element.title].join('') :
                    object.movie.original_title + element.title + balanser);
                element.timeline = view;
                item.append(Lampa.Timeline.render(view));
                if (Lampa.Timeline.details) item.find('.online__quality').append(Lampa.Timeline.details(view, ' / '));
                if (viewed.indexOf(hash_file) !== -1) item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');

                item.on('hover:enter', function () {
                    if (element.loading) return;
                    if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
                    element.loading = true;
                    var extra = getFile(element);
                    element.loading = false;
                    if (!extra.file) { Lampa.Noty.show('Не вдалося отримати посилання'); return; }
                    if (extra.iframe) { openFrame(extra.file); return; }

                    var first = {
                        url: extra.file,
                        quality: renameQuality(extra.quality),
                        subtitles: extra.subtitles,
                        timeline: element.timeline,
                        title: element.season ? element.title : (object.movie.title || '') + (element.title == object.movie.title ? '' : ' / ' + element.title)
                    };
                    var playlist = [first];
                    if (element.season) {
                        playlist = [];
                        items.forEach(function (el) {
                            var ex = getFile(el);
                            playlist.push({
                                url: ex.file, quality: renameQuality(ex.quality),
                                subtitles: ex.subtitles, timeline: el.timeline, title: el.title
                            });
                        });
                    }
                    if (playlist.length > 1) first.playlist = playlist;
                    Lampa.Player.play(first);
                    Lampa.Player.playlist(playlist);

                    if (viewed.indexOf(hash_file) == -1) {
                        viewed.push(hash_file);
                        item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                        Lampa.Storage.set('online_view', viewed);
                    }
                });

                item.on('hover:long', function () {
                    var enabled = Lampa.Controller.enabled().name;
                    Lampa.Select.show({
                        title: '', items: [
                            { title: 'Позначити як переглянуте', mark: true },
                            { title: 'Прибрати позначку', clearmark: true },
                            { title: 'Скинути тайм-код', timeclear: true },
                            { title: 'Копіювати посилання', copylink: true }
                        ],
                        onBack: function () { Lampa.Controller.toggle(enabled); },
                        onSelect: function (a) {
                            if (a.clearmark) {
                                Lampa.Arrays.remove(viewed, hash_file);
                                Lampa.Storage.set('online_view', viewed);
                                item.find('.torrent-item__viewed').remove();
                            }
                            if (a.mark && viewed.indexOf(hash_file) == -1) {
                                viewed.push(hash_file);
                                item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                                Lampa.Storage.set('online_view', viewed);
                            }
                            if (a.timeclear) {
                                view.percent = 0; view.time = 0; view.duration = 0;
                                Lampa.Timeline.update(view);
                            }
                            Lampa.Controller.toggle(enabled);
                            if (a.copylink) {
                                var ex = getFile(element);
                                Lampa.Utils.copyTextToClipboard(ex.file, function () {
                                    Lampa.Noty.show('Посилання скопійовано');
                                }, function () {});
                            }
                        }
                    });
                });

                _this.append(item);
            });

            this.start(true);
        };

        function getFile(element) {
            var items = element.media.items || [];
            var file = items.length ? items[0].file : '';
            var quality = false;
            if (items.length > 1) {
                quality = {};
                items.forEach(function (i) { if (!quality[i.label]) quality[i.label] = i.file; });
            }
            return { file: file, quality: quality, subtitles: element.media.subtitles, iframe: !!(items[0] && items[0].iframe) };
        }

        function renameQuality(q) { return q; } // за потреби: мапа label→url

        // ---------- фільтр ----------
        this.refilter = function (voice_titles) {
            var select = [
                { title: 'Скинути', reset: true },
                {
                    title: 'Джерело: ' + SITES[balanser].title, stype: 'source',
                    items: site_names.map(function (n) { return { title: SITES[n].title, selected: n === balanser }; })
                }
            ];
            if (voice_titles && voice_titles.length > 1) {
                select.push({
                    title: 'Озвучка/сезон: ' + (voice_titles[sources[balanser].choice_voice] || ''),
                    stype: 'voice',
                    items: voice_titles.map(function (name, i) {
                        return { title: name, selected: i === sources[balanser].choice_voice };
                    })
                });
            }
            filter.set('filter', select);
            filter.set('sort', site_names.map(function (n) {
                return { title: SITES[n].title, selected: n === balanser, source: n };
            }));
            filter.chosen('filter', []);
            filter.chosen('sort', [SITES[balanser].title]);
        };

        // ---------- старт/пошук ----------
        this.create = function () {
            var _this = this;
            this.activity.loader(true);

            filter.onSearch = function (value) {
                Lampa.Activity.replace({ search: value, search_date: '', clarification: true });
            };
            filter.onBack = this.back;
            filter.onSelect = function (type, a, b) {
                if (type == 'filter') {
                    if (a.reset) { _this.find(); return; }
                    if (a.stype == 'source') {
                        var n = site_names.filter(function (k) { return SITES[k].title === b.title; })[0];
                        _this.change_source(n || site_names[0]);
                    } else if (a.stype == 'voice') {
                        sources[balanser].choice_voice = b.index;
                        _this.appendItems(sources[balanser].filtred());
                        _this.refilter(voicesTitles());
                    }
                } else if (type == 'sort') _this.change_source(a.source);
            };

            files.appendHead(filter.render());
            files.appendFiles(scroll.render());
            scroll.body().addClass('torrent-list');
            scroll.minus(files.render().find('.explorer__files-head'));

            this.find();
            return this.render();
        };

        function voicesTitles() {
            // заголовки озвучок поточного джерела (для оновлення фільтра)
            try {
                var f = sources[balanser].filtred();
                return null; // спрощено: фільтр оновлюється при новому пошуку
            } catch (e) { return null; }
        }

        this.change_source = function (name) {
            balanser = name;
            Lampa.Storage.set('online_ua_balanser', balanser);
            this.find();
            setTimeout(function () { if ($('body').hasClass('selectbox--open')) Lampa.Select.close(); }, 10);
        };

        this.find = function () {
            this.activity.loader(true);
            this.reset();
            this.refilter(null);
            sources[balanser].search(object, null, null);
        };

        this.start = function (first_select) {
            if (Lampa.Activity.active().activity !== this.activity) return;
            if (first_select) {
                last = scroll.render().find('.selector').eq(0)[0];
            }
            Lampa.Background.immediately(Lampa.Utils.cardImgBackground(object.movie));
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function () { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down: function () { Navigator.move('down'); },
                right: function () {
                    if (Navigator.canmove('right')) Navigator.move('right');
                    else filter.show('', 'filter');
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                back: this.back
            });
            if (this.inActivity()) Lampa.Controller.toggle('content');
        };

        this.render = function () { return files.render(); };
        this.back = function () { Lampa.Activity.backward(); };
        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {
            network.clear();
            files.destroy();
            scroll.destroy();
            site_names.forEach(function (n) { sources[n].destroy(); });
        };
    }

    ////////////////////// Шаблони / Мова / Запуск //////////////////////

    function resetTemplates() {
        Lampa.Template.add('online_ua',
            '<div class="online selector"><div class="online__body">' +
            '<div class="online__title" style="padding-left:0">{title}</div>' +
            '<div class="online__quality">{quality}{info}</div>' +
            '</div></div>');
        Lampa.Template.add('online_ua_folder',
            '<div class="online selector"><div class="online__body">' +
            '<div class="online__title" style="padding-left:0">{title}</div>' +
            '<div class="online__quality">{quality}{info}</div>' +
            '</div></div>');
    }

    function startPlugin() {
        try {
            Lampa.Component.add('online_ua', component);

            var manifest = {
                type: 'video',
                version: mod_version,
                name: 'Онлайн UA - ' + mod_version,
                description: 'Дивитись онлайн (українські джерела)',
                component: 'online_ua'
            };
            if (Lampa.Manifest) Lampa.Manifest.plugins = manifest;

            var button = '<div class="full-start__button selector view--online_ua" data-subtitle="online_ua ' + mod_version + '">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 244 260">' +
                '<path d="M242,88v170H10V88h41l-38,38h37.1l38-38h38.4l-38,38h38.4l38-38h38.3l-38,38H204L242,88L242,88z M228.9,2l8,37.7l0,0 L191.2,10L228.9,2z M160.6,56l-45.8-29.7l38-8.1l45.8,29.7L160.6,56z M84.5,72.1L38.8,42.4l38-8.1l45.8,29.7L84.5,72.1z M10,88 L2,50.2L47.8,80L10,88z" fill="currentColor"/></svg>' +
                '<span>Онлайн UA</span></div>';

            Lampa.Listener.follow('full', function (e) {
                if (e.type == 'complite') {
                    var btn = $(button);
                    btn.on('hover:enter', function () {
                        Lampa.Activity.push({
                            url: '',
                            title: 'Онлайн UA',
                            component: 'online_ua',
                            search: e.data.movie.title,
                            search_one: e.data.movie.title,
                            search_two: e.data.movie.original_title,
                            movie: e.data.movie,
                            page: 1
                        });
                    });
                    e.object.activity.render().find('.view--torrent').after(btn);
                }
            });

            log('плагін запущено, джерел:', site_names.length);
        } catch (e) {
            console.error(LOG + 'помилка запуску', e);
        }
    }

    if (!window.online_ua_started) {
        window.online_ua_started = true;
        resetTemplates();
        startPlugin();
    }

})();
