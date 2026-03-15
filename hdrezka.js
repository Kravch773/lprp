(function () {
    'use strict';

    // ════════════════════════════════════════
    //  КОНФИГУРАЦИЯ
    // ════════════════════════════════════════
    var HD = {
        version : '1.0.0',
        base    : 'https://hdrezka.ag',
        proxy   : '',   // задаётся через настройки Lampa
    };

    // ════════════════════════════════════════
    //  ДЕКОДЕР URL (HDRezka «trash encoding»)
    //  Сайт кодирует ссылки: base64 + мусорные символы
    // ════════════════════════════════════════
    var TRASH = ['//_//','////','###','##','**','!!','@@','///','//#','#/','/#','@#v'];

 function clearTrash(s) {
    var trashList = [
        '//_//','////','###','##','**','!!','@@','///',
        '//#','#/','/#','@#v','!@','@!','#!','!#',
        '^^','~~','||','__','€'
    ];
    trashList.forEach(function(t) { s = s.split(t).join(''); });
    s = s.replace(/[^A-Za-z0-9+\/=]/g, ''); // только base64 символы
    return s;
}

function decodeHdUrl(raw) {
    raw = raw.trim().replace(/^\/\//, '');
    raw = raw.split('#')[0].split(' ')[0].split(',')[0];
    raw = clearTrash(raw);
    while (raw.length % 4 !== 0) raw += '='; // base64 padding
    try { return atob(raw); } catch(e) { return ''; }
}

function parseQualities(urlStr) {
    if (!urlStr) return [];
    var result = [];
    // Разбиваем по запятой перед [качеством]
    var parts = urlStr.split(/,(?=\[)/);
    parts.forEach(function(part) {
        var m = part.match(/\[([^\]]+)\](.*?)(?:\s+or\s+.*)?$/);
        if (!m) return;
        var quality = m[1].trim();
        // Берём первое зеркало (до " or ")
        var rawUrl = m[2].split(' or ')[0].trim();
        var decoded = decodeHdUrl(rawUrl);
        if (decoded && decoded.indexOf('http') === 0) {
            result.push({ quality: quality, url: decoded });
        }
    });
    return result.reverse(); // лучшее качество первым
}



    // ════════════════════════════════════════
    //  HTTP-обёртки
    // ════════════════════════════════════════
function get(url, ok, fail) {
    var u = HD.proxy ? HD.proxy + encodeURIComponent(url) : url;
    // var u = url.replace('https://hdrezka.ag', 'http://localhost:8010/proxy');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', u, true);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.timeout = 15000;
    xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) ok(xhr.responseText);
        else { console.error('[HDRezka] GET status:', xhr.status, u); if (fail) fail(xhr.status); }
    };
    xhr.onerror   = function (e) { console.error('[HDRezka] GET error:', u, e); if (fail) fail(e); };
    xhr.ontimeout = function ()  { console.error('[HDRezka] GET timeout:', u);  if (fail) fail('timeout'); };
    xhr.send();
}

function post(path, data, ok, fail) {
    var u = HD.proxy
        ? HD.proxy + encodeURIComponent(HD.base + path)
        : HD.base + path;
    var body = Object.keys(data)
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(data[k]); })
        .join('&');
    var xhr = new XMLHttpRequest();
    xhr.open('POST', u, true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.timeout = 15000;
    xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
            try { ok(JSON.parse(xhr.responseText)); }
            catch (e) { console.error('[HDRezka] JSON parse error:', e); if (fail) fail(e); }
        } else { console.error('[HDRezka] POST status:', xhr.status, u); if (fail) fail(xhr.status); }
    };
    xhr.onerror   = function (e) { console.error('[HDRezka] POST error:', u, e); if (fail) fail(e); };
    xhr.ontimeout = function ()  { console.error('[HDRezka] POST timeout:', u);  if (fail) fail('timeout'); };
    xhr.send(body);
}

    // ════════════════════════════════════════
    //  ПОИСК
    // ════════════════════════════════════════
    function search(query, done) {
        var url = HD.base + '/search/?do=search&subaction=search&q=' + encodeURIComponent(query);
        get(url, function (html) { done(parseSearchHtml(html)); }, function () { done([]); });
    }

    function parseSearchHtml(html) {
        var items = [];
        var doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('.b-content__inline_item').forEach(function (el) {
            var titleEl = el.querySelector('.b-content__inline_item-link a');
            var coverEl = el.querySelector('.b-content__inline_item-cover a');
            var imgEl   = el.querySelector('img');
            var miscEl  = el.querySelector('.misc');
            if (!titleEl) return;
            items.push({
                title : titleEl.textContent.trim(),
                url   : (coverEl || titleEl).getAttribute('href'),
                poster: imgEl  ? imgEl.getAttribute('src')       : '',
                info  : miscEl ? miscEl.textContent.trim()        : ''
            });
        });
        return items;
    }

    // ════════════════════════════════════════
    //  СТРАНИЦА ФИЛЬМА / СЕРИАЛА
    // ════════════════════════════════════════

function getMoviePage(url, done) {
    get(url, function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');

        // Пробуем все возможные места где хранится ID
        var movieId = null;

        // Вариант 1: data-id на плеере
        var p1 = doc.querySelector('#oframecdnplayer');
        if (p1) movieId = p1.getAttribute('data-id');

        // Вариант 2: data-id на блоке рейтинга
        if (!movieId) {
            var p2 = doc.querySelector('[data-id]');
            if (p2) movieId = p2.getAttribute('data-id');
        }

        // Вариант 3: из URL  /12345-название/
        if (!movieId) movieId = extractId(url);

        // Вариант 4: ищем в скриптах страницы (sof.tv_cdn_params)
        if (!movieId) {
            var scripts = doc.querySelectorAll('script');
            scripts.forEach(function(s) {
                var m = s.textContent.match(/sof\.tv_cdn_params\s*=\s*\{[^}]*"id"\s*:\s*"?(\d+)"?/);
                if (m) movieId = m[1];
            });
        }

        console.log('[HDRezka] movieId найден:', movieId, 'из URL:', url);

        var isSeries = !!(
            doc.querySelector('.b-content__episode_item') ||
            doc.querySelector('#simple-episodes-list') ||
            doc.querySelector('.b-post__schedule')
        );

        var translators = [];
        doc.querySelectorAll('#translators-list > li[data-translator_id]').forEach(function (li) {
            translators.push({
                id  : li.getAttribute('data-translator_id'),
                name: li.textContent.trim()
            });
        });

        // Дефолтный переводчик из плеера
        if (!translators.length) {
            var pl = doc.querySelector('#oframecdnplayer');
            translators.push({
                id  : pl ? (pl.getAttribute('data-translator_id') || '0') : '0',
                name: 'Оригинал'
            });
        }

        console.log('[HDRezka] переводчики:', translators);
        console.log('[HDRezka] isSeries:', isSeries);

        done({ movieId: movieId, isSeries: isSeries, translators: translators });
    }, function () { done(null); });
}

    
    function extractId(url) {
        var m = url.match(/\/(\d+)-/);
        return m ? m[1] : '';
    }

    // ════════════════════════════════════════
    //  AJAX-ЗАПРОСЫ К ПЛЕЕРУ
    // ════════════════════════════════════════

    /** Стрим для фильма */
// Вспомогательная функция для лога через уведомление
function log(msg) {
    console.log('[HDRezka]', msg);
    Lampa.Noty.show('[HD] ' + msg);
}

function getMovieStream(id, tId, done) {
    log('id=' + id + ' tr=' + tId);

    if (!id || id === 'null' || id === 'undefined' || !id.toString().trim()) {
        log('ERROR: movieId пустой!');
        return done([]);
    }

    post('/ajax/get_cdn_series/', {
        id           : id,
        translator_id: tId,
        action       : 'get_movie'
    }, function (j) {
        if (!j) { log('ERROR: пустой ответ'); return done([]); }
        log('success=' + j.success + ' msg=' + (j.message || '-'));
        if (j.success && j.url) {
            log('URL=' + j.url.substring(0, 60));   // первые 60 символов
            var streams = parseQualities(j.url);
            log('streams=' + streams.length);
            done(streams);
        } else {
            log('FAIL: ' + JSON.stringify(j).substring(0, 100));
            done([]);
        }
    }, function (e) {
        log('POST error: ' + e);
        done([]);
    });
}



    /** Список сезонов/эпизодов */
    function getEpisodeList(id, tId, done) {
        post('/ajax/get_cdn_series/', { id: id, translator_id: tId, action: 'get_episodes' },
            function (j) { done(j && j.success ? parseSeasonsEpisodes(j.seasons, j.episodes) : {}); },
            function ()  { done({}); }
        );
    }

    /** Стрим конкретного эпизода */
    function getEpisodeStream(id, tId, season, episode, done) {
        post('/ajax/get_cdn_series/', {
                id: id, translator_id: tId,
                season: season, episode: episode, action: 'get_stream'
            },
            function (j) { done(j && j.success ? parseQualities(j.url) : []); },
            function ()  { done([]); }
        );
    }

    function parseSeasonsEpisodes(seasonsHtml, episodesHtml) {
        var res = {};
        var p = new DOMParser();
        p.parseFromString(seasonsHtml || '', 'text/html')
            .querySelectorAll('li[data-tab_id]').forEach(function (li) {
                res[li.getAttribute('data-tab_id')] = { title: li.textContent.trim(), episodes: [] };
            });
        p.parseFromString(episodesHtml || '', 'text/html')
            .querySelectorAll('li[data-season_id]').forEach(function (li) {
                var s = li.getAttribute('data-season_id');
                var e = li.getAttribute('data-episode_id');
                if (res[s]) res[s].episodes.push({ id: e, title: li.textContent.trim() });
            });
        return res;
    }

    // ════════════════════════════════════════
    //  UI
    // ════════════════════════════════════════
    function notify(msg) { Lampa.Noty.show(msg); }

    function playStreams(streams, title) {
        if (!streams.length) return notify('HDRezka: потоки не найдены');
        Lampa.Select.show({
            title   : title || 'Выберите качество',
            items   : streams.map(function (s) { return { title: s.quality, url: s.url }; }),
            onSelect: function (item) {
                Lampa.Player.play({ url: item.url, title: title || 'HDRezka' });
            },
            onBack  : function () { Lampa.Controller.toggle('content'); }
        });
    }

    function showEpisodes(movieId, tId, seasons) {
        var keys = Object.keys(seasons);
        if (!keys.length) return notify('HDRezka: сезоны не найдены');

        Lampa.Select.show({
            title   : 'Сезон',
            items   : keys.map(function (k) { return { title: seasons[k].title, id: k }; }),
            onSelect: function (season) {
                var eps = seasons[season.id].episodes;
                if (!eps.length) return notify('Нет эпизодов');
                Lampa.Select.show({
                    title   : season.title,
                    items   : eps.map(function (e) {
                        return { title: e.title, sid: season.id, eid: e.id };
                    }),
                    onSelect: function (ep) {
                        notify('Загрузка...');
                        getEpisodeStream(movieId, tId, ep.sid, ep.eid, function (streams) {
                            playStreams(streams, season.title + ' · ' + ep.title);
                        });
                    },
                    onBack  : function () { Lampa.Controller.toggle('content'); }
                });
            },
            onBack  : function () { Lampa.Controller.toggle('content'); }
        });
    }

    function showTranslators(movieId, translators, isSeries) {
        if (translators.length <= 1) {
            return loadContent(movieId, (translators[0] || { id: '0' }).id, isSeries);
        }
        Lampa.Select.show({
            title   : 'Перевод',
            items   : translators.map(function (t) {
                return { title: t.name + (t.isPremium ? ' ★' : ''), id: t.id };
            }),
            onSelect: function (item) { loadContent(movieId, item.id, isSeries); },
            onBack  : function () { Lampa.Controller.toggle('content'); }
        });
    }

    function loadContent(movieId, tId, isSeries) {
        notify('Загрузка...');
        if (isSeries) {
            getEpisodeList(movieId, tId, function (seasons) {
                showEpisodes(movieId, tId, seasons);
            });
        } else {
            getMovieStream(movieId, tId, function (streams) {
                playStreams(streams, 'HDRezka');
            });
        }
    }

    function showSearchResults(results) {
        if (!results.length) return notify('HDRezka: ничего не найдено');
        Lampa.Select.show({
            title   : 'HDRezka — результаты',
            items   : results.map(function (r) {
                return { title: r.title + (r.info ? '  (' + r.info + ')' : ''), url: r.url };
            }),
            onSelect: function (item) {
                notify('Загрузка страницы...');
                getMoviePage(item.url, function (info) {
                    if (!info) return notify('Ошибка загрузки страницы');
                    showTranslators(info.movieId, info.translators, info.isSeries);
                });
            },
            onBack  : function () { Lampa.Controller.toggle('content'); }
        });
    }

    // ════════════════════════════════════════
    //  ТОЧКА ВХОДА
    // ════════════════════════════════════════
    function openForCard(movie) {
        var query = movie.original_title || movie.title || '';
        if (!query) return notify('Нет названия для поиска');
        notify('Поиск на HDRezka...');
        search(query, showSearchResults);
    }

    // ════════════════════════════════════════
    //  НАСТРОЙКИ (Lampa Settings)
    // ════════════════════════════════════════
    function initSettings() {
        Lampa.SettingsApi.addParam({
            component: 'network',
            param    : { name: 'hdrezka_proxy', type: 'input', value: '' },
            field    : {
                name       : 'HDRezka — прокси',
                description: 'http://lampac-host:9118/proxy?url= (нужен вне Android-WebView)'
            },
            onChange : function (v) {
                HD.proxy = v;
                Lampa.Storage.set('hdrezka_proxy', v);
            }
        });
        HD.proxy = Lampa.Storage.get('hdrezka_proxy', '');
    }

    // ════════════════════════════════════════
    //  КНОПКА НА КАРТОЧКЕ ФИЛЬМА
    // ════════════════════════════════════════
function addCardButton() {
    Lampa.Listener.follow('full', function (e) {
        if (e.type !== 'complite') return;

        // ✅ В этой версии Lampa фильм в e.object.card
        var movie = e.object.card || e.object.movie || 
                    (e.object.activity && e.object.activity.movie);
        if (!movie) return;

        // ✅ render не передаётся — берём DOM напрямую
        var btns = document.querySelector('.full-start-new__buttons');
        if (!btns) return;

        // Не дублировать
        if (btns.querySelector('.hd-rezka-btn')) return;

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

        var optionsBtn = btns.querySelector('.button--options');
        if (optionsBtn) btns.insertBefore(btn, optionsBtn);
        else btns.appendChild(btn);
    });
}




    // ════════════════════════════════════════
    //  INIT
    // ════════════════════════════════════════
    function init() {
        initSettings();
        addCardButton();
        console.log('[HDRezka Plugin] v' + HD.version + ' загружен');
    }

    // Ждём готовности Lampa
    if (window.Lampa && Lampa.Listener) {
        init();
    } else {
        var t = setInterval(function () {
            if (window.Lampa && Lampa.Listener) { clearInterval(t); init(); }
        }, 300);
    }

})();
