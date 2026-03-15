(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════
    //  UTILS
    // ═══════════════════════════════════════════════════════
    function startsWith(str, val) { return str && str.indexOf(val) === 0; }

    function cleanTitle(str) {
        return (str || '').replace(/[.,!?:;'"]/g, '').replace(/\s+/g, ' ').trim();
    }

    function fixLink(url, ref) {
        if (!url) return url;
        if (startsWith(url, '//')) url = 'https:' + url;
        if (startsWith(url, '/')) url = ref + url;
        return url;
    }

    // ═══════════════════════════════════════════════════════
    //  ПЛАТФОРМА
    // ═══════════════════════════════════════════════════════
    var isAndroid = !!(window.Lampa && Lampa.Platform && Lampa.Platform.isandroid);

    // ═══════════════════════════════════════════════════════
    //  КОНФИГУРАЦИЯ
    // ═══════════════════════════════════════════════════════
    var HOST    = 'https://hdrezka.ag';
    var UA      = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.178 Mobile Safari/537.36';

    // Заголовки ТОЛЬКО на Android — на PC они вызывают CORS preflight!
    var HEADERS = isAndroid
        ? { 'Origin': HOST, 'Referer': HOST + '/', 'User-Agent': UA }
        : {};

    // ═══════════════════════════════════════════════════════
    //  ДЕКОДЕР URL (HDRezka trash encoding)
    //  Источник алгоритма: online_mod.js / rezka2
    // ═══════════════════════════════════════════════════════
    function _enc(str) {
        return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (m, p1) {
            return String.fromCharCode('0x' + p1);
        }));
    }

    function _dec(str) {
        return decodeURIComponent(
            atob(str).split('').map(function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join('')
        );
    }

    // Мусорные строки (base64-кодируются перед подстановкой)
    var TRASH = ['!!!', '!!', '!!!', '!!!', '!!!'];

    function decodeStreamUrl(raw) {
        if (!raw || !startsWith(raw.trim(), '//')) return raw;
        var x = raw.trim().substring(2);
        TRASH.forEach(function (t) { x = x.replace(_enc(t), ''); });
        try { x = _dec(x); } catch (e) { return ''; }
        return x;
    }

    // ═══════════════════════════════════════════════════════
    //  ПАРСЕР ПОТОКОВ "[1080p]//enc1 or //enc2,[720p]//enc3"
    // ═══════════════════════════════════════════════════════
    function parseStreamUrls(urlStr) {
        if (!urlStr) return [];
        var items = [];
        var parts = urlStr.split(/,(?=\[)/);
        parts.forEach(function (part) {
            var m = part.match(/^\[([^\]]+)\](.+)$/);
            if (!m) return;
            var label = m[1].trim();
            var links = m[2].split(' or ').map(function (u) {
                return decodeStreamUrl(u.trim());
            }).filter(function (u) { return u && startsWith(u, 'http'); });
            if (links.length) {
                var qMatch  = label.match(/(\d+)/);
                var qMatchK = label.match(/(\d+)K/i);
                var quality = NaN;
                if (qMatchK) quality = parseInt(qMatchK[1]) * 1000;
                else if (qMatch) quality = parseInt(qMatch[1]);
                items.push({ label: label, quality: quality, file: links[0] });
            }
        });
        items.sort(function (a, b) { return b.quality - a.quality; });
        return items;
    }

    // ═══════════════════════════════════════════════════════
    //  СЕТЬ — Lampa.Reguest (именно так, как в online_mod)
    // ═══════════════════════════════════════════════════════
    function get(network, url, ok, fail) {
        network.clear();
        network.timeout(10000);
        network.native(url, ok, fail, false, {
            dataType: 'text',
            withCredentials: isAndroid,
            headers: HEADERS
        });
    }

    function post(network, url, data, ok, fail) {
        network.clear();
        network.timeout(10000);
        network.native(url, ok, fail, data, {
            dataType: 'text',
            withCredentials: isAndroid,
            headers: HEADERS
        });
    }

    // ═══════════════════════════════════════════════════════
    //  ПАРСИНГ СТРАНИЦЫ ФИЛЬМА (regex, как в online_mod)
    // ═══════════════════════════════════════════════════════
    function extractPageData(str) {
        var data = {
            filmId   : null,
            isSeries : false,
            voice    : [],
            season   : [],
            episode  : [],
            voiceData: {},
            favs     : ''
        };
        if (!str) return data;
        str = str.replace(/&nbsp;/g, ' ');

        // ID фильма
        var cSeries = str.match(/\.initCDNSeriesEvents\((\d+),\s*(\d+)/);
        var cMovie  = str.match(/\.initCDNMoviesEvents\((\d+),\s*(\d+),\s*([^,]*),\s*([^,]*),\s*([^)]*)/);

        // Имя озвучки по умолчанию
        var trRow = str.match(/<h2[^>]*>[\s\S]*?<\/h2>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/);
        var defName = trRow ? trRow[1].replace(/<[^>]+>/g, '').trim() : '';

        if (cSeries) {
            data.isSeries = true;
            data.filmId   = cSeries[1];
            var defVoiceS = { name: defName || 'Оригинал', id: cSeries[2] };
        } else if (cMovie) {
            data.filmId = cMovie[1];
            var defVoiceM = {
                name     : defName || 'Оригинал',
                id       : cMovie[2],
                iscamrip : (cMovie[3] || '0').trim(),
                isads    : (cMovie[4] || '0').trim(),
                isdirector: (cMovie[5] || '0').trim()
            };
        }

        // Список переводчиков
        var voiceBlock = str.match(/ul\s+id="translators-list"[\s\S]*?<\/ul>/);
        if (voiceBlock) {
            var vDoc = new DOMParser().parseFromString(voiceBlock[0], 'text/html');
            vDoc.querySelectorAll('.b-translator__item').forEach(function (li) {
                var name = (li.getAttribute('title') || li.textContent || '').trim()
                    .replace(/<[^>]+>/g, '').trim();
                data.voice.push({
                    name      : name || 'Оригинал',
                    id        : li.getAttribute('data-translator_id') || '0',
                    iscamrip  : li.getAttribute('data-camrip')   || '0',
                    isads     : li.getAttribute('data-ads')       || '0',
                    isdirector: li.getAttribute('data-director')  || '0'
                });
            });
        }
        if (!data.voice.length) {
            data.voice.push(cSeries ? defVoiceS : (cMovie ? defVoiceM : { name: 'Оригинал', id: '0' }));
        }

        // Сезоны / Эпизоды
        if (data.isSeries) {
            var sBlock = str.match(/ul\s+id="simple-seasons-tabs"[\s\S]*?<\/ul>/);
            if (sBlock) {
                var sDoc = new DOMParser().parseFromString(sBlock[0], 'text/html');
                sDoc.querySelectorAll('.b-simple_season__item').forEach(function (li) {
                    data.season.push({ name: li.textContent.trim(), id: li.getAttribute('data-tab_id') });
                });
            }
            var eBlock = str.match(/div\s+id="simple-episodes-tabs"[\s\S]*?<\/div>/);
            if (eBlock) {
                var eDoc = new DOMParser().parseFromString(eBlock[0], 'text/html');
                eDoc.querySelectorAll('.b-simple_episode__item').forEach(function (li) {
                    data.episode.push({
                        name      : li.textContent.trim(),
                        seasonId  : li.getAttribute('data-season_id'),
                        episodeId : li.getAttribute('data-episode_id')
                    });
                });
            }
        }

        // favs
        var favsM = str.match(/input\s+type="hidden"\s+id="ctrl\[favs\]"\s+value="([^"]+)"/);
        if (favsM) data.favs = favsM[1];

        return data;
    }

    // ═══════════════════════════════════════════════════════
    //  ПАРСИНГ РЕЗУЛЬТАТОВ ПОИСКА
    // ═══════════════════════════════════════════════════════
    function parseSearch(html) {
        var items = [];
        if (!html) return items;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('.b-content__inline_item').forEach(function (el) {
            var coverLink = el.querySelector('.b-content__inline_item-cover a');
            var titleLink = el.querySelector('.b-content__inline_item-link a');
            var miscEl    = el.querySelector('.misc');
            if (!coverLink && !titleLink) return;
            var href  = (coverLink || titleLink).getAttribute('href') || '';
            var title = titleLink ? titleLink.textContent.trim() : href;
            var alt   = el.querySelector('a[class*="title"]');
            var origtitle = '';
            if (alt) origtitle = alt.textContent.trim();
            // Год из misc
            var misc  = miscEl ? miscEl.textContent.trim() : '';
            var yearM = misc.match(/(\d{4})/);
            items.push({
                title    : title,
                origtitle: origtitle,
                year     : yearM ? parseInt(yearM[1]) : 0,
                url      : href,
                info     : misc
            });
        });
        return items;
    }

    // ═══════════════════════════════════════════════════════
    //  ЭПИЗОДЫ — обновление через AJAX
    // ═══════════════════════════════════════════════════════
    function parseEpisodesResponse(json, translatorId) {
        var data = { season: [], episode: [] };
        if (json.seasons) {
            var sDoc = new DOMParser().parseFromString(json.seasons, 'text/html');
            sDoc.querySelectorAll('.b-simple_season__item').forEach(function (li) {
                data.season.push({ name: li.textContent.trim(), id: li.getAttribute('data-tab_id') });
            });
        }
        if (json.episodes) {
            var eDoc = new DOMParser().parseFromString(json.episodes, 'text/html');
            eDoc.querySelectorAll('.b-simple_episode__item').forEach(function (li) {
                data.episode.push({
                    name      : li.textContent.trim(),
                    translatorId: translatorId,
                    seasonId  : li.getAttribute('data-season_id'),
                    episodeId : li.getAttribute('data-episode_id')
                });
            });
        }
        return data;
    }

    // ═══════════════════════════════════════════════════════
    //  ОСНОВНАЯ ЛОГИКА
    // ═══════════════════════════════════════════════════════
    function openForCard(movie) {
        var query = cleanTitle(movie.original_title || movie.originalTitle || movie.title || '');
        if (!query) return Lampa.Noty.show('HDRezka: нет названия для поиска');

        var network = new Lampa.Reguest();
        var extract = null;

        Lampa.Noty.show('HDRezka: поиск "' + query + '"...');

        // ── Шаг 1: Поиск ──
        var searchUrl = HOST + '/engine/ajax/search.php';
        post(network, searchUrl, 'q=' + encodeURIComponent(query),
            function (html) {
                var results = parseSearch(html);
                if (!results.length) {
                    // Fallback: GET поиск
                    get(network,
                        HOST + '/search/?do=search&subaction=search&q=' + encodeURIComponent(query),
                        function (html2) { showResults(network, parseSearch(html2), movie, query); },
                        function ()      { Lampa.Noty.show('HDRezka: ошибка поиска'); network.clear(); }
                    );
                } else {
                    showResults(network, results, movie, query);
                }
            },
            function () {
                Lampa.Noty.show('HDRezka: ошибка запроса поиска');
                network.clear();
            }
        );
    }

    function showResults(network, results, movie, query) {
        if (!results.length) {
            network.clear();
            return Lampa.Noty.show('HDRezka: ничего не найдено по "' + query + '"');
        }
        Lampa.Select.show({
            title   : 'HDRezka — результаты',
            items   : results.map(function (r) {
                return { title: r.title + (r.info ? '  (' + r.info + ')' : ''), url: r.url };
            }),
            onSelect: function (item) {
                Lampa.Noty.show('HDRezka: загрузка страницы...');
                // ── Шаг 2: Страница фильма ──
                var pageUrl = fixLink(item.url, HOST);
                get(network, pageUrl,
                    function (html) {
                        var data = extractPageData(html);
                        if (!data.filmId) {
                            network.clear();
                            return Lampa.Noty.show('HDRezka: не удалось получить ID фильма');
                        }
                        // ── Шаг 3: Выбор перевода ──
                        showVoices(network, data, movie.title || query);
                    },
                    function () {
                        network.clear();
                        Lampa.Noty.show('HDRezka: ошибка загрузки страницы');
                    }
                );
            },
            onBack: function () { network.clear(); Lampa.Controller.toggle('content'); }
        });
    }

    function showVoices(network, data, baseTitle) {
        if (data.voice.length <= 1) {
            return loadContent(network, data, data.voice[0] || { id: '0', name: 'Оригинал' }, baseTitle);
        }
        Lampa.Select.show({
            title   : 'Перевод / Озвучка',
            items   : data.voice.map(function (v) {
                return { title: v.name || 'Оригинал', voice: v };
            }),
            onSelect: function (item) { loadContent(network, data, item.voice, baseTitle); },
            onBack  : function () { Lampa.Controller.toggle('content'); }
        });
    }

    function loadContent(network, data, voice, baseTitle) {
        Lampa.Noty.show('HDRezka: загрузка...');
        if (data.isSeries) {
            // Загружаем список эпизодов через AJAX
            var postData = [
                'id='            + encodeURIComponent(data.filmId),
                'translator_id=' + encodeURIComponent(voice.id),
                'favs='          + encodeURIComponent(data.favs),
                'action=get_episodes'
            ].join('&');
            post(network, HOST + '/ajax/get_cdn_series/?t=' + Date.now(), postData,
                function (resp) {
                    var json;
                    try { json = JSON.parse(resp); } catch (e) { }
                    if (json && json.success) {
                        var eps = parseEpisodesResponse(json, voice.id);
                        data.voiceData[voice.id] = eps;
                        data.season  = eps.season;
                        data.episode = eps.episode;
                    }
                    showSeasons(network, data, voice, baseTitle);
                },
                function () { showSeasons(network, data, voice, baseTitle); }
            );
        } else {
            fetchMovieStream(network, data, voice, baseTitle);
        }
    }

    function showSeasons(network, data, voice, baseTitle) {
        if (!data.season.length) return Lampa.Noty.show('HDRezka: сезоны не найдены');
        Lampa.Select.show({
            title   : 'Сезон',
            items   : data.season.map(function (s) { return { title: s.name, id: s.id }; }),
            onSelect: function (seasonItem) {
                var eps = data.episode.filter(function (e) { return e.seasonId === seasonItem.id; });
                if (!eps.length) return Lampa.Noty.show('HDRezka: нет эпизодов');
                Lampa.Select.show({
                    title   : seasonItem.title,
                    items   : eps.map(function (e) { return { title: e.name, ep: e }; }),
                    onSelect: function (epItem) {
                        Lampa.Noty.show('HDRezka: загрузка эпизода...');
                        var postData = [
                            'id='            + encodeURIComponent(data.filmId),
                            'translator_id=' + encodeURIComponent(voice.id),
                            'season='        + encodeURIComponent(epItem.ep.seasonId),
                            'episode='       + encodeURIComponent(epItem.ep.episodeId),
                            'favs='          + encodeURIComponent(data.favs),
                            'action=get_stream'
                        ].join('&');
                        post(network, HOST + '/ajax/get_cdn_series/?t=' + Date.now(), postData,
                            function (resp) { handleStreamResponse(resp, baseTitle + ' — ' + seasonItem.title + ' — ' + epItem.title); },
                            function ()     { Lampa.Noty.show('HDRezka: ошибка загрузки потока'); }
                        );
                    },
                    onBack: function () { Lampa.Controller.toggle('content'); }
                });
            },
            onBack: function () { Lampa.Controller.toggle('content'); }
        });
    }

    function fetchMovieStream(network, data, voice, baseTitle) {
        var postData = [
            'id='            + encodeURIComponent(data.filmId),
            'translator_id=' + encodeURIComponent(voice.id),
            'is_camrip='     + encodeURIComponent(voice.iscamrip   || '0'),
            'is_ads='        + encodeURIComponent(voice.isads      || '0'),
            'is_director='   + encodeURIComponent(voice.isdirector || '0'),
            'favs='          + encodeURIComponent(data.favs),
            'action=get_movie'
        ].join('&');
        post(network, HOST + '/ajax/get_cdn_series/?t=' + Date.now(), postData,
            function (resp) { handleStreamResponse(resp, baseTitle); },
            function ()     { Lampa.Noty.show('HDRezka: ошибка загрузки потока'); }
        );
    }

    function handleStreamResponse(resp, title) {
        var json;
        try { json = JSON.parse(resp); } catch (e) {
            return Lampa.Noty.show('HDRezka: ошибка разбора ответа');
        }
        if (!json || !json.success) {
            return Lampa.Noty.show('HDRezka: ' + (json && json.message || 'потоки не найдены'));
        }
        var streams = parseStreamUrls(json.url);
        if (!streams.length) return Lampa.Noty.show('HDRezka: не удалось декодировать URL');
        playStreams(streams, title);
    }

    function playStreams(streams, title) {
        var qualityMap = {};
        streams.forEach(function (s) { qualityMap[s.label] = s.file; });
        var bestUrl = streams[0].file;
        Lampa.Player.play({
            url     : bestUrl,
            title   : title || 'HDRezka',
            quality : qualityMap
        });
        if (streams.length > 1) {
            Lampa.Player.playlist(streams.map(function (s) {
                return { url: s.file, title: s.label };
            }));
        }
    }

    // ═══════════════════════════════════════════════════════
    //  КНОПКА НА КАРТОЧКЕ ФИЛЬМА
    // ═══════════════════════════════════════════════════════
    function addCardButton() {
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;

            // Фильм: в этой версии Lampa — e.object.card
            var movie = e.object.card
                || (e.object.activity && e.object.activity.movie)
                || e.object.movie;
            if (!movie) return;

            // render: может быть функцией или элементом
            var render = typeof e.object.render === 'function'
                ? e.object.render()
                : e.object.render;
            if (!render) render = document.querySelector('.full-start');
            if (!render) return;

            if (render.querySelector('.hd-rezka-btn')) return; // не дублируем

            var btns = render.querySelector('.full-start-new__buttons')
                    || render.querySelector('.full-start__buttons');
            if (!btns) return;

            var btn = document.createElement('div');
            btn.className = 'full-start__button selector button--hdrezka hd-rezka-btn';
            btn.setAttribute('tabindex', '0');
            btn.innerHTML = [
                '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">',
                '<polygon points="5 3 19 12 5 21 5 3"/>',
                '</svg>',
                '<div class="full-start__button-name">HDRezka</div>'
            ].join('');

            btn.addEventListener('click', function () { openForCard(movie); });

            var optBtn = btns.querySelector('.button--options');
            if (optBtn) btns.insertBefore(btn, optBtn);
            else        btns.appendChild(btn);
        });
    }

    // ═══════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════
    function init() {
        addCardButton();
        console.log('[HDRezka] v2.0 loaded | platform: ' + (isAndroid ? 'Android' : 'PC/TV'));
    }

    if (window.Lampa && Lampa.Listener) {
        init();
    } else {
        var _t = setInterval(function () {
            if (window.Lampa && Lampa.Listener) { clearInterval(_t); init(); }
        }, 300);
    }

})();
