/**
 * 小红书页面采集解析器
 */
export default class XiaohongshuScraper {
    constructor() {
        this.platform = '0'; // 0-小红书 1-抖音 (对应业务表字典)
        this.name = '小红书';
    }

    canHandle(url) {
        return url && (
            url.includes('xiaohongshu.com/explore') || 
            url.includes('xiaohongshu.com/search_result')
        );
    }

    /**
     * 根据关键词和过滤条件构造搜索 URL
     */
    getSearchUrl(keyword, filters = {}) {
        const encoded = encodeURIComponent(keyword);
        let type = filters.type === 'video' ? '54' : '51';
        let url = `https://www.xiaohongshu.com/search_result?keyword=${encoded}&source=web_search_result_notes&type=${type}`;
        
        if (filters.sort === 'newest') {
            url += '&sort=time';
        }
        return url;
    }

    /**
     * 页面筛选
     */
    async applyFilters(page, filters = {}, { log } = {}) {
        const stepLog = (msg, type) => log && log(`[筛选] ${msg}`, type);
        
        if (filters.unseen) {
            stepLog(`正在尝试启用平台原生“未看过”过滤...`, 'warning');
            try {
                await page.evaluate(async () => {
                    const findAndClick = (txt) => {
                        const items = Array.from(document.querySelectorAll('div, span, button, .filter-item'));
                        const target = items.find(el => el.innerText && el.innerText.trim() === txt);
                        if (target) { target.click(); return true; }
                        return false;
                    };
                    if (findAndClick('筛选')) {
                        await new Promise(r => setTimeout(r, 600));
                        findAndClick('未看过');
                    }
                });
                await new Promise(r => setTimeout(r, 3000));
                stepLog(`“未看过”过滤已触发`, 'success');
            } catch (e) {
                stepLog(`“未看过”设置异常: ${e.message}`, 'error');
            }
        }

        if (filters.region === 'local' || filters.region === 'nearby') {
            const targetText = filters.region === 'local' ? '同城' : '附近';
            stepLog(`正在检索【${targetText}】筛选器位置...`, 'warning');
            try {
                const quickClicked = await page.evaluate((txt) => {
                    const btns = Array.from(document.querySelectorAll('button, .tab-item, span'));
                    const target = btns.find(b => b.innerText && b.innerText.trim() === txt);
                    if (target) { target.click(); return true; }
                    return false;
                }, targetText);

                if (!quickClicked) {
                    await page.evaluate(async (txt) => {
                        const findAndClick = (val) => {
                            const els = Array.from(document.querySelectorAll('div, span, button'));
                            const el = els.find(e => e.innerText && e.innerText.trim() === val);
                            if (el) { el.click(); return true; }
                            return false;
                        };
                        if (findAndClick('筛选')) {
                            await new Promise(r => setTimeout(r, 800));
                            return findAndClick(txt);
                        }
                        return false;
                    }, targetText);
                }
                await new Promise(r => setTimeout(r, 3500));
            } catch (e) {
                stepLog(`筛选执行异常: ${e.message}`, 'error');
            }
        }
    }

    /**
     * 执行页面解析与多轮滚动提取
     */
    async extractData(browser, page, { checkControl, onItemScraped, checkExisting, filters = {}, log } = {}) {
        const stepLog = (msg, type) => log && log(`[提取] ${msg}`, type);
        const maxRounds = parseInt(filters.maxRounds) || 1; 
        const startFrom = parseInt(filters.startRound) || 1; 
        
        const sessionProcessedIds = new Set();

        try {
            // 1. 预位移 (跳过之前的轮数)
            const roundsToSkip = startFrom - 1;
            if (roundsToSkip > 0) {
                stepLog(`正在快速俯冲至目标起始深度 (跳过前 ${roundsToSkip} 轮历史内容)...`, 'warning');
                for (let i = 0; i < roundsToSkip; i++) {
                    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            // 2. 循环采集
            for (let round = 0; round < maxRounds; round++) {
                const globalRound = startFrom + round;
                stepLog(`正在深度扫描 [ 第 ${globalRound} 轮 ] 的搜索内容...`, 'primary');

                // 每一轮开始先确认是否有新内容加载 (除了初始状态且无跳过的第一轮)
                if (round > 0 || startFrom > 1) {
                    // 执行大幅度向下深潜，并模拟人类微调以触发异步加载
                    await page.evaluate(() => {
                        window.scrollBy(0, window.innerHeight * 2.5);
                        setTimeout(() => window.scrollBy(0, 500), 500);
                    });
                    // 为网络加载预留充足时间 (4s - 6s)
                    await new Promise(r => setTimeout(r, 4500 + Math.random() * 1500));
                }

                // 提取链接
                const links = await page.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('a'));
                    const urlMap = new Map();
                    elements.forEach(a => {
                        const href = a.href;
                        if (!href) return;
                        const match = href.match(/\/(explore|search_result|note)\/([a-zA-Z0-9]+)/);
                        if (match && match[2]) {
                            const id = match[2];
                            if (id.length < 10) return;
                            const hasToken = href.includes('xsec_token');
                            const currentBest = urlMap.get(id);
                            if (!currentBest || (hasToken && !currentBest.includes('xsec_token')) || href.length > currentBest.length) {
                                urlMap.set(id, href);
                            }
                        }
                    });
                    return Array.from(urlMap.values());
                });

                if (!links || links.length === 0) {
                    stepLog(`[第 ${globalRound} 轮] 未探测到有效链接，可能由于页面未加载完成。尝试继续深潜...`, 'warning');
                    continue;
                }

                // 提取当前轮次的有效 ID (内存级去重)
                const candidateIds = links.map(link => {
                    const m = link.match(/\/(explore|search_result|note)\/([a-zA-Z0-9]+)/);
                    return m ? m[2] : null;
                }).filter(id => id && !sessionProcessedIds.has(id));

                if (candidateIds.length === 0) {
                    stepLog(`[第 ${globalRound} 轮] 发现的 ${links.length} 个节点在本次任务中均已处理。`, 'info');
                    continue;
                }

                // 执行存量比对
                stepLog(`探测到 ${candidateIds.length} 个潜在新 ID，正在执行云端对齐...`, 'info');
                const existingIds = checkExisting ? await checkExisting(candidateIds) : [];
                
                const freshLinks = links.filter(link => {
                    const m = link.match(/\/(explore|search_result|note)\/([a-zA-Z0-9]+)/);
                    const id = m ? m[2] : null;
                    return id && !sessionProcessedIds.has(id) && !existingIds.includes(id);
                });

                const cloudSkip = candidateIds.length - freshLinks.length;
                if (cloudSkip > 0) {
                    stepLog(`[云端拦截] 已自动过滤 ${cloudSkip} 条历史重复。`, 'warning');
                }

                if (freshLinks.length === 0) {
                    stepLog(`[第 ${globalRound} 轮] 已无库外新内容。`, 'info');
                    continue;
                }

                // 详情页穿透解析
                for (let i = 0; i < freshLinks.length; i++) {
                    if (checkControl && !(await checkControl())) return true;

                    const postUrl = freshLinks[i];
                    const postId = postUrl.match(/\/(explore|search_result|note)\/([a-zA-Z0-9]+)/)[2];
                    
                    // 改为用户易读的进度名称
                    stepLog(`🚩 [轮次:第${globalRound}轮 | 当前:第${i+1}/${freshLinks.length}条] 正在提取详情: ...${postId.substring(postId.length - 8)}`, 'info');
                    
                    const newPage = await browser.newPage();
                    try {
                        await newPage.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                        const singleData = await this.extractSinglePost(newPage);
                        if (singleData && singleData.postId) {
                            if (onItemScraped) await onItemScraped(singleData);
                        }
                        sessionProcessedIds.add(postId);
                    } catch (e) {
                        console.error(`解析失败: ${e.message}`);
                    } finally {
                        await newPage.close().catch(() => {});
                    }
                    // 随机休眠防封控
                    await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
                }
            }
            return true;
        } catch (error) {
            throw new Error(`解析页面逻辑失败: ${error.message}`);
        }
    }

    /**
     * 提取单独一篇帖子页面的所有内容
     */
    async extractSinglePost(page) {
        // 1. 等待核心容器
        await page.waitForSelector('.note-container', { timeout: 8000 }).catch(() => {});

        // 2. 核心：智能等待标题和内容真正渲染 (由于小红书异步渲染，初次抓取经常是“温馨提示”或空)
        await page.waitForFunction(() => {
            const titleEl = document.querySelector('#detail-title') || document.querySelector('.title');
            const title = titleEl ? titleEl.innerText.trim() : '';
            // 如果标题包含“温馨提示”或者为空，说明还没加载完
            return title && title !== '温馨提示' && !title.includes('加载中');
        }, { timeout: 5000 }).catch(() => {
            console.log(`[XiaohongshuScraper] 页面渲染较慢，尝试强制提取...`);
        });

        const data = await page.evaluate(() => {
            const url = window.location.href;
            let postId = '';
            const match = url.match(/\/(explore|search_result|note)\/([a-zA-Z0-9]{15,})/);
            if (match && match[2]) postId = match[2];

            const titleEl = document.querySelector('#detail-title') || document.querySelector('.title');
            const title = titleEl ? titleEl.innerText.trim() : '';
            
            // 如果标题依然是“温馨提示”，标记为无效记录
            if (title === '温馨提示' || !title) return null;

            const descEl = document.querySelector('#detail-desc') || document.querySelector('.desc');
            const content = descEl ? descEl.innerText.trim() : '';

            const authorEl = document.querySelector('.author-wrapper .name') || document.querySelector('.author-name');
            const author = authorEl ? authorEl.innerText.trim() : '';

            // ===== 图片解析 (结构化多画质) =====
            const images = [];
            try {
                const state = window.__INITIAL_STATE__;
                if (state && state.note && state.note.noteDetailMap) {
                    const noteMap = state.note.noteDetailMap;
                    for (const key of Object.keys(noteMap)) {
                        const noteImgList = noteMap[key]?.note?.imageList;
                        if (noteImgList && noteImgList.length > 0) {
                            for (const img of noteImgList) {
                                images.push({
                                    width: img.width || 0,
                                    height: img.height || 0,
                                    urlDefault: img.urlDefault || '',  // 高清版
                                    urlPre: img.urlPre || '',          // 预览版
                                });
                            }
                            break;
                        }
                    }
                }
            } catch (e) { /* ignore */ }
            // 降级：如果 __INITIAL_STATE__ 没拿到图片，从 DOM 兜底
            if (images.length === 0) {
                document.querySelectorAll('.swiper-slide:not(.swiper-slide-duplicate) img').forEach(img => {
                    if (img.offsetWidth > 100 || img.offsetHeight > 100) {
                        const src = img.src || img.getAttribute('data-src');
                        if (src && !src.includes('avatar')) {
                            images.push({ width: img.naturalWidth || 0, height: img.naturalHeight || 0, urlDefault: src, urlPre: '' });
                        }
                    }
                });
            }

            // ===== 视频解析 (多分辨率真实直链，自动筛选最高画质 & 无水印) =====
            const videos = [];
            let videoUrl = '';
            try {
                const state = window.__INITIAL_STATE__;
                if (state && state.note && state.note.noteDetailMap) {
                    const noteMap = state.note.noteDetailMap;
                    const noteKeys = Object.keys(noteMap);
                    for (const key of noteKeys) {
                        const noteVideo = noteMap[key]?.note?.video;
                        if (noteVideo && noteVideo.media && noteVideo.media.stream) {
                            const stream = noteVideo.media.stream;
                            // 遍历所有编码格式 (h264, h265, av1...)
                            for (const [codec, streams] of Object.entries(stream)) {
                                if (!Array.isArray(streams)) continue;
                                for (const s of streams) {
                                    videos.push({
                                        codec: codec,
                                        quality: s.qualityType || 'unknown',
                                        width: s.width || 0,
                                        height: s.height || 0,
                                        fps: s.fps || 0,
                                        duration: s.duration || 0,
                                        size: s.size || 0,
                                        bitrate: s.videoBitrate || 0,
                                        format: s.format || 'mp4',
                                        url: s.masterUrl || '',
                                        backupUrl: (s.backupUrls && s.backupUrls[0]) || ''
                                    });
                                }
                            }
                            
                            // 核心：执行最高分辨率排序逻辑 (分辨率优先 > 码率优先)
                            if (videos.length > 0) {
                                videos.sort((a, b) => {
                                    const areaA = a.width * a.height;
                                    const areaB = b.width * b.height;
                                    if (areaB !== areaA) return areaB - areaA;
                                    return b.bitrate - a.bitrate;
                                });
                                // 提取排在首位的最高画质
                                videoUrl = videos[0].url;
                            }
                            break; 
                        }
                    }
                }
            } catch (e) {
                // __INITIAL_STATE__ 解析失败，降级到 DOM 提取
                const v = document.querySelector('video');
                if (v && v.src && !v.src.startsWith('blob:')) {
                    videoUrl = v.src;
                    videos.push({ codec: 'unknown', quality: 'unknown', width: 0, height: 0, url: v.src, backupUrl: '' });
                }
            }

            return { postId, title, content, author, sourceUrl: url, images: JSON.stringify(images), videos: JSON.stringify(videos), videoUrl };
        });

        if (!data) return null;

        return { platform: this.platform, ...data };
    }
}
