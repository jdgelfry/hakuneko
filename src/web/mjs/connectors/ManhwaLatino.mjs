import WordPressMadara from './templates/WordPressMadara.mjs';

export default class ManhwaLatino extends WordPressMadara {

    constructor() {
        super();
        super.id = 'manhwalatino';
        super.label = 'Manhwa-Latino';
        this.tags = [ 'webtoon', 'hentai', 'spanish' ];
        this.url = 'https://manhwa-latino.com';
        this.requestOptions.headers.set('x-referer', this.url);
        this.requestOptions.headers.set('referer', this.url);

    }

    async _initializeConnector() {
        const request = new Request(this.url, this.requestOptions);
        const script = `
            new Promise(resolve => {
                const deadline = Date.now() + 20000;
                const waitForUnlock = () => {
                    const ready = document.readyState === 'complete';
                    const challengeSolved = !!document.querySelector('body:not(.cf-challenge-running)');
                    if ((ready && challengeSolved) || Date.now() > deadline) {
                        resolve(true);
                    } else {
                        setTimeout(waitForUnlock, 500);
                    }
                };
                waitForUnlock();
            });
        `;
        await Engine.Request.fetchUI(request, script, 60000, true);
    }

    _createMangaRequest(page) {
        return new Request(new URL(`/manga/page/${page}/`, this.url), this.requestOptions);
    }

    async fetchDOM(request, selector, retries, encoding) {
        try {
            const result = await super.fetchDOM(request, selector, retries, encoding);
            if (selector && (!result || result.length === 0)) {
                return this._fetchDOMViaUI(request, selector);
            }
            return result;
        } catch (error) {
            return this._fetchDOMViaUI(request, selector, error);
        }
    }

    _ensureRequest(input) {
        if (input instanceof Request) {
            return new Request(input, {
                method: input.method,
                headers: input.headers,
                referrer: input.referrer,
                referrerPolicy: input.referrerPolicy,
                mode: input.mode,
                credentials: input.credentials,
                cache: input.cache,
                redirect: input.redirect,
                integrity: input.integrity,
                keepalive: input.keepalive,
                signal: input.signal
            });
        }
        if (input instanceof URL) {
            return new Request(input.href, this.requestOptions);
        }
        if (typeof input === 'string') {
            const href = /^https?:/i.test(input) ? input : new URL(input, this.url).href;
            return new Request(href, this.requestOptions);
        }
        throw new Error('Unsupported request input type');
    }

    async _fetchDOMViaUI(request, selector, originalError) {
        try {
            const target = this._ensureRequest(request);
            const headers = new Headers(target.headers);
            headers.set('x-referer', this.url);
            headers.set('referer', this.url);
            const uiRequest = new Request(target, {
                method: target.method,
                headers,
                referrer: target.referrer || this.url,
                referrerPolicy: target.referrerPolicy,
                mode: target.mode,
                credentials: target.credentials,
                cache: target.cache,
                redirect: target.redirect,
                integrity: target.integrity,
                keepalive: target.keepalive,
                signal: target.signal
            });
            const script = `
                new Promise(resolve => {
                    const selector = ${JSON.stringify(selector || null)};
                    const deadline = Date.now() + 45000;
                    const isChallengeActive = () => {
                        const title = document.title || '';
                        const normalized = title.toLowerCase();
                        if (normalized.includes('just a moment')) {
                            return true;
                        }
                        if (document.querySelector('#challenge-form') || document.querySelector('#challenge-error-text')) {
                            return true;
                        }
                        if (document.querySelector('body[data-what="cf-chl-bypass"]')) {
                            return true;
                        }
                        return false;
                    };
                    const snapshot = status => JSON.stringify({ status, html: document.documentElement.outerHTML });
                    const check = () => {
                        const challenge = isChallengeActive();
                        const hasContent = !selector || document.querySelectorAll(selector).length > 0;
                        if (!challenge && hasContent) {
                            resolve(snapshot('ok'));
                            return;
                        }
                        if (Date.now() > deadline) {
                            resolve(snapshot(challenge ? 'challenge' : 'timeout'));
                            return;
                        }
                        setTimeout(check, 750);
                    };
                    check();
                });
            `;
            const payload = await Engine.Request.fetchUI(uiRequest, script, 60000, true);
            let data;
            try {
                data = JSON.parse(payload);
            } catch (_) {
                data = { status: 'ok', html: payload };
            }
            if (data.status !== 'ok') {
                throw originalError || new Error('Cloudflare challenge not solved');
            }
            const dom = this.createDOM(data.html);
            const elements = selector ? [...dom.querySelectorAll(selector)] : dom;
            if (selector && (!elements || elements.length === 0) && originalError) {
                throw originalError;
            }
            return elements;
        } catch (error) {
            throw originalError || error;
        }
    }

    async _getChapters(manga) {
        const uri = new URL(manga.id, this.url);
        const request = new Request(uri, this.requestOptions);
        const data = await this.fetchDOM(request, 'li.wp-manga-chapter div.mini-letters > a');
        return data.map(element => {
            return {
                id: this.getRootRelativeOrAbsoluteLink(element, this.url),
                title: element.text.trim()
            };
        });
    }

    async _getPages(chapter) {
        const uri = new URL(chapter.id, this.url);
        const request = new Request(uri, this.requestOptions);
        const data = await this.fetchDOM(request, 'div.page-break source.img-responsive');
        return data.map(image => {
            const payload = {
                url : image.getAttribute('data-src'),
                referer : request.url
            };
            return this.createConnectorURI(payload);
        });
    }
}
