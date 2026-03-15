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
        TRASH.forEach(function (t) { s = s.split(t).join(''); });
        return s;
    }

    function decodeHdUrl(raw) {
        // Формат из AJAX-ответа: //BASE64ENCODED#HASH
        var cleaned = raw.replace(/^\/\//, '').split('#')[0];
        cleaned = clearTrash(cleaned).trim();
        try { return atob(cleaned); } catch (e) { return ''; }
    }

    /**
     * Парсит строку качеств:
     * "[1080p]//enc1 or //enc2,[720p]//enc3"
     * → [{quality:'1080p', url:'https://...'}, ...]
     */
    function parseQualities(urlStr) {
        if (!urlStr) return [];
        var result = [];
        var re = /\[([^\]]+)\]((?:\/\/[^\[,]+?)(?:\s+or\s+\/\/[^\[,]+?)*?)(?=,\[|$)/g;
        var m;
        while ((m = re.exec(urlStr)) !== null) {
            var quality = m[1].trim();
            var bestUrl = '';
            m[2].split(' or ').forEach(function (raw) {
                if (bestUrl) return;          // берём первое зеркало
                var dec = decodeHdUrl(raw.trim());
                if (dec && /^https?:/.test(dec)) bestUrl = dec;
            });
            if (bestUrl) result.push({ quality: quality, url: bestUrl });
        }
        return result.reverse();             // лучшее качество первым
    }

    // ════════════════════════════════════════
    //  HTTP-обёртки
    // ════════════════════════════════════════
    function get(url, ok, fail) {
        var u = HD.proxy ? HD.proxy + encodeURIComponent(url) : url;
        Lampa.Ajax.native({
            url    : u,
            method : 'GET',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            timeout: 15000,
            success: ok,
            error  : fail || function () {}
        });
    }

    function post(path, data, ok, fail) {
        var body = Object.keys(data)
            .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(data[k]); })
            .join('&');
        var u = HD.proxy ? HD.proxy + encodeURIComponent(HD.base + path) : HD.base + path;
        Lampa.Ajax.native({
            url    : u,
            method : 'POST',
            headers: {
                'Content-Type'     : 'application/x-www-form-urlencoded',
                'X-Requested-With' : 'XMLHttpRequest'
            },
            data   : body,
            timeout: 15000,
            success: function (r) {
                try { ok(typeof r === 'string' ? JSON.parse(r) : r); }
                catch (e) { if (fail) fail(e); }
            },
            error: fail || function () {}
        });
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

            // ID фильма
            var idEl    = doc.querySelector('#b-content-rating-votes-wrapper,[data-id]');
            var movieId = idEl ? idEl.getAttribute('data-id') : extractId(url);

            // Тип контента
            var isSeries = !!(
                doc.querySelector('.b-content__episode_item') ||
                doc.querySelector('#simple-episodes-list')
            );

            // Переводчики
            var translators = [];
            doc.querySelectorAll('#translators-list > li[data-translator_id]').forEach(function (li) {
                translators.push({
                    id       : li.getAttribute('data-translator_id'),
                    name     : li.textContent.trim(),
                    isPremium: li.classList.contains('b-prem_translator')
                });
            });

            // Нет списка — один дефолтный переводчик
            if (!translators.length) {
                var pEl = doc.querySelector('#oframecdnplayer');
                translators.push({
                    id      : pEl ? (pEl.getAttribute('data-translator_id') || '0') : '0',
                    name    : 'Оригинал',
                    isPremium: false
                });
            }

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
    function getMovieStream(id, tId, done) {
        post('/ajax/get_cdn_series/', { id: id, translator_id: tId, action: 'get_movie' },
            function (j) { done(j && j.success ? parseQualities(j.url) : []); },
            function ()  { done([]); }
        );
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

        var render = e.object.render();
        var movie  = e.object.activity.movie;

        if (render.querySelector('.hd-rezka-btn')) return;

        // ← точный селектор из твоей консоли
        var btns = render.querySelector('.full-start-new__buttons');
        if (!btns) return;

        var btn = document.createElement('div');
        // ← точный формат классов как у соседних кнопок
        btn.className = 'full-start__button selector button--hdrezka hd-rezka-btn';
        btn.setAttribute('tabindex', '0');
        btn.innerHTML = [
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">',
            '<polygon points="5 3 19 12 5 21 5 3"/>',
            '</svg>',
            '<div class="full-start__button-name">HDRezka</div>'
        ].join('');

        btn.addEventListener('click', function () { openForCard(movie); });

        // Вставляем перед кнопкой "..." (button--options)
        var optionsBtn = btns.querySelector('.button--options');
        if (optionsBtn) {
            btns.insertBefore(btn, optionsBtn);
        } else {
            btns.appendChild(btn);
        }
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
