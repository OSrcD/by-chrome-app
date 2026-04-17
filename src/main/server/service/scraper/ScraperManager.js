import puppeteer from 'puppeteer';
import axios from 'axios';
import logger from '../../../logger/logger.js';
import XiaohongshuScraper from './plugins/XiaohongshuScraper';
import ScraperAutomation from './ScraperAutomation.js';

/**
 * 平台字典映射
 */
const PLATFORM_MAP = {
    '0': '小红书',
    '1': '抖音',
    '2': '快手',
    '3': '闲鱼',
    '4': '视频号',
    '5': 'B站',
    '6': '其他'
};

/**
 * 素材采集器管理分发类
 */
class ScraperManager {
    constructor() {
        // 注册所有采集插件
        this.plugins = [
            new XiaohongshuScraper()
        ];

        // 后端写入接口地址
        this.BACKEND_API_URL = 'http://localhost:8080/business/scraper/save';
        // this.BACKEND_API_URL = 'http://admin.ruoyivueplus.wulynk.com:8700/prod-api/business/scraper/save';

        // 维护各个端口的任务状态: running | paused | stopped
        this.taskStates = {};

        // 外部日志回调 (用于 IPC 推送)
        this.onStepLog = null;
    }

    /**
     * 统一日志输出口：终端记录 + 前端实时同步
     */
    log(port, msg, type = 'info') {
        logger.info(`[Scraper][Port:${port}] ${msg}`);
        if (this.onStepLog) {
            this.onStepLog(port, msg, type);
        }
    }

    /**
     * 设置任务状态
     */
    setTaskStatus(port, status) {
        logger.info(`[ScraperManager] 端口 ${port} 状态切换为: ${status}`);
        this.taskStates[port] = status;
    }

    /**
     * 获取任务状态
     */
    getTaskStatus(port) {
        return this.taskStates[port] || 'running';
    }

    /**
     * 阻塞并检查暂停/停止状态
     * @returns {boolean} true-继续运行 | false-已停止
     */
    async checkTaskControl(port) {
        // 1. 如果已停止，直接返回 false
        if (this.taskStates[port] === 'stopped') {
            return false;
        }

        // 2. 如果已暂停，进入自旋等待
        while (this.taskStates[port] === 'paused') {
            await new Promise(r => setTimeout(r, 1000));
            // 如果在暂停期间被切到了停止，则跳出返回
            if (this.taskStates[port] === 'stopped') return false;
        }

        return true;
    }

    /**
     * 基于关键词搜索并采集
     * @param {string} host 宿主机地址
     * @param {number} port 调试端口
     * @param {string} platform 平台标识 (如 '0' 表示小红书)
     * @param {string} keyword 关键词
     * @param {Object} filters 过滤条件 { sort, type, region, ... }
     */
    async scrapeBySearch(host, port, platform, keyword, filters = {}) {
        const platformName = PLATFORM_MAP[platform] || platform;
        this.log(port, `正在加载「${platformName}」业务解析模块...`, 'info');
        // 查找匹配平台的插件
        const plugin = this.plugins.find(p => p.platform === platform);
        if (!plugin) {
            this.log(port, `未找到匹配平台插件: ${platform}`, 'error');
            return { success: false, msg: `不支持的平台类型: ${platform}` };
        }

        // 1. 获取搜索 URL
        const searchUrl = plugin.getSearchUrl ? plugin.getSearchUrl(keyword, filters) : null;
        if (!searchUrl) {
            this.log(port, `构造搜索请求失败，该插件可能不支持搜索 URL 指令`, 'error');
            return { success: false, msg: `插件 [${plugin.platform}] 不支持关键词搜索 URL 构造` };
        }

        this.log(port, `[方案规划] 搜索路径构造成功: ${searchUrl.substring(0, 50)}...`, 'success');

        return this.internalScrape(host, port, {
            targetUrl: searchUrl,
            filters: filters,
            plugin: plugin // 直接传递已找到的插件
        });
    }

    /**
     * 对指定端口的环境执行页面采集
     * @param {string} host 宿主机地址
     * @param {number} port 调试端口
     */
    async scrapeCurrentPage(host, port) {
        this.log(port, `[同步触发] 正在分析当前活跃页面的业务解析逻辑...`, 'primary');
        return this.internalScrape(host, port);
    }

    /**
     * 对指定 URL 进行采集测试
     * @param {string} host 宿主机地址
     * @param {number} port 调试端口
     * @param {string} url 目标采集 URL
     */
    async scrapeByUrl(host, port, url) {
        this.log(port, `[穿透指令] 正在建立与目标的连接: ${url.substring(0, 30)}...`, 'primary');
        return this.internalScrape(host, port, { targetUrl: url });
    }

    /**
     * 内部通用采集逻辑
     */
    async internalScrape(host, port, options = {}) {
        const { targetUrl, filters, plugin: providedPlugin } = options;
        this.log(port, `[系统接管] 正在启动自动化素材采集与提取引擎...`, 'primary');

        // 初始化状态为运行中
        this.taskStates[port] = 'running';

        // 快捷日志闭包：供插件内部调用
        const pluginLog = (msg, type) => this.log(port, msg, type);

        let browser;
        try {
            browser = await puppeteer.connect({
                browserURL: `http://${host}:${port}`,
                defaultViewport: null
            });

            const pages = await browser.pages();
            // 排除 devtools 等页面
            let page = pages.find(p => !p.url().startsWith('devtools://') && !p.url().startsWith('chrome-extension://'));
            if (!page) page = await browser.newPage();

            // 如果指定了 URL，则先导航
            if (targetUrl) {
                this.log(port, `[会话控制] 正在引导浏览器跳转至目标工作区...`, 'info');
                await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                // 给页面一点基础加载时间
                await new Promise(r => setTimeout(r, 2000));
            }

            // 如果有插件且有额外的筛选逻辑，先执行筛选点击
            if (providedPlugin && providedPlugin.applyFilters && filters) {
                this.log(port, `正在应用平台专用筛选器(去重/同城/活跃度)...`, 'warning');
                // 传给插件内部的回调，使其直接广播
                await providedPlugin.applyFilters(page, filters, { log: pluginLog });
                await new Promise(r => setTimeout(r, 2000));
            }

            const currentUrl = page.url();
            this.log(port, `当前激活页面锚点: ${currentUrl.substring(0, 60)}...`, 'info');

            // 匹配解析器 (如果没传则自动匹配)
            const plugin = providedPlugin || this.plugins.find(p => p.canHandle(currentUrl));
            if (!plugin) {
                if (browser) await browser.disconnect();
                return { success: false, msg: `此页面找不到匹配的解析器，无法采集: ${currentUrl}` };
            }

            // 定义成功的统计
            let stats = { success: 0, skip: 0, total: 0 };

            // 定义检查点函数供插件内部调用
            const checkControl = async () => await this.checkTaskControl(port);

            // 定义单条采集结果的回调处理 (实时入库 + 实时日志)
            const onItemScraped = async (item) => {
                if (!item || !item.postId) return;

                stats.total++;
                this.log(port, `实时采集到第 ${stats.total} 条: [${item.title?.substring(0, 15) || '无标题'}]`, 'success');

                // ---- 新增：采集时媒体资源同步至后端 (转 PNG + 托管) ----
                try {
                    await this._transformMediaFiles(item, page, pluginLog);
                } catch (e) {
                    this.log(port, `媒体同步失败，将退避使用原链接: ${e.message}`, 'warning');
                }

                const pushMsg = await this.pushToBackend(item).catch(err => `推送异常: ${err.message}`);
                // 根据后端返回判断重复
                if (pushMsg.includes('重复') || pushMsg.includes('已存在')) {
                    stats.skip++;
                    this.log(port, `[自动过滤] 检测到重复博文，已智能跳过`, 'info');
                } else if (!pushMsg.includes('错误') && !pushMsg.includes('异常')) {
                    stats.success++;
                }
            };

            // 核心解析 (将控制信号、采集回调和日志回调全部透传)
            await plugin.extractData(browser, page, {
                checkControl,
                onItemScraped,
                checkExisting: (ids) => this.checkExistingIds(plugin.platform, ids),
                filters: filters,
                log: pluginLog
            });

            await browser.disconnect();

            const finalMsg = `采集任务整体作业完成！ 共发现 ${stats.total} 条，成功入库 ${stats.success} 条，跳过 ${stats.skip} 条重复。`;
            this.log(port, finalMsg, 'primary');
            return { success: true, data: { stats }, msg: finalMsg };

        } catch (error) {
            this.log(port, `任务执行异常: ${error.message}`, 'error');
            if (browser) await browser.disconnect().catch(() => { });
            return { success: false, msg: `素材采集发生异常: ${error.message}` };
        } finally {
            // 任务结束，彻底清理状态
            delete this.taskStates[port];
        }
    }

    /**
     * 批量检查 ID 是否已存在 (用于前置去重，提升效率)
     */
    async checkExistingIds(platform, postIds) {
        if (!postIds || postIds.length === 0) return [];
        try {
            const checkUrl = this.BACKEND_API_URL.replace('/save', '/check');
            const res = await axios.post(checkUrl, { platform, postIds });
            if (res.data.code === 200) {
                return res.data.data || [];
            }
            return [];
        } catch (error) {
            logger.error(`[ScraperManager] 批量检查 ID 失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 将采集的数据推送到 RuoYi-Vue-Plus 后端保存
     * @param {Object} data
     */
    async pushToBackend(data) {
        try {
            logger.info(`[ScraperManager] 正在将 [${data.platform}] 帖子推送到后端保存...`);
            const res = await axios.post(this.BACKEND_API_URL, data);
            if (res.data.code === 200) {
                logger.info(`[ScraperManager] 后端返回: ${res.data.msg}`);
                return res.data.msg;
            } else {
                logger.warn(`[ScraperManager] 后端警告: ${res.data.msg}`);
                return res.data.msg;
            }
        } catch (error) {
            logger.error(`[ScraperManager] 推送后端失败: ${error.message}`);
            throw new Error(`连接后台服务失败，请确认 ${this.BACKEND_API_URL} 已启动`);
        }
    }

    /**
     * 批量刷新视频链接：查询后端待刷新帖子 → 逐个访问页面重新提取 → 回传更新后端
     * @param {string} host 宿主机地址
     * @param {number} port 调试端口
     * @param {Function} logFn 日志回调
     */
    async batchRefreshVideos(host, port, logFn) {
        const log = logFn || ((msg) => logger.info(`[VideoRefresh] ${msg}`));

        // 1. 从后端查询所有待刷新的帖子
        log('正在查询待刷新视频的帖子...');
        let pendingPosts = [];
        try {
            const res = await axios.get(this.BACKEND_API_URL.replace('/save', '/pendingRefresh'));
            if (res.data.code === 200 && res.data.data) {
                pendingPosts = res.data.data;
            }
        } catch (e) {
            log(`查询待刷新帖子失败: ${e.message}`);
            return { success: false, msg: e.message };
        }

        if (pendingPosts.length === 0) {
            log('当前没有待刷新的视频帖子。');
            return { success: true, msg: '无待刷新帖子', refreshed: 0 };
        }

        log(`发现 ${pendingPosts.length} 条待刷新帖子，开始逐条刷新...`);

        let browser;
        let refreshed = 0;
        try {
            browser = await puppeteer.connect({
                browserURL: `http://${host}:${port}`,
                defaultViewport: null
            });

            for (let i = 0; i < pendingPosts.length; i++) {
                const post = pendingPosts[i];
                log(`[${i + 1}/${pendingPosts.length}] 正在刷新: ${post.sourceUrl?.substring(0, 50) || '未知'}...`);

                const newPage = await browser.newPage();
                try {
                    await newPage.goto(post.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    await newPage.waitForSelector('.note-container', { timeout: 8000 }).catch(() => { });

                    const mediaData = await newPage.evaluate(() => {
                        const images = [];
                        const videos = [];
                        try {
                            const state = window.__INITIAL_STATE__;
                            if (state?.note?.noteDetailMap) {
                                for (const key of Object.keys(state.note.noteDetailMap)) {
                                    const note = state.note.noteDetailMap[key]?.note;
                                    if (!note) continue;

                                    // 提取图片
                                    if (note.imageList && note.imageList.length > 0) {
                                        for (const img of note.imageList) {
                                            images.push({
                                                width: img.width || 0, height: img.height || 0,
                                                urlDefault: img.urlDefault || '', urlPre: img.urlPre || ''
                                            });
                                        }
                                    }

                                    // 提取视频
                                    if (note.video?.media?.stream) {
                                        for (const [codec, streams] of Object.entries(note.video.media.stream)) {
                                            if (!Array.isArray(streams)) continue;
                                            for (const s of streams) {
                                                videos.push({
                                                    codec, quality: s.qualityType || 'unknown',
                                                    width: s.width || 0, height: s.height || 0,
                                                    fps: s.fps || 0, duration: s.duration || 0,
                                                    size: s.size || 0, bitrate: s.videoBitrate || 0,
                                                    format: s.format || 'mp4',
                                                    url: s.masterUrl || '',
                                                    backupUrl: (s.backupUrls && s.backupUrls[0]) || ''
                                                });
                                            }
                                        }
                                        // 排序：分辨率优先 > 码率优先
                                        if (videos.length > 0) {
                                            videos.sort((a, b) => {
                                                const areaA = a.width * a.height;
                                                const areaB = b.width * b.height;
                                                if (areaB !== areaA) return areaB - areaA;
                                                return b.bitrate - a.bitrate;
                                            });
                                        }
                                    }
                                    break;
                                }
                            }
                        } catch (e) { /* ignore */ }
                        const videoUrl = videos.length > 0 ? videos[0].url : '';
                        return { images, videos, videoUrl };
                    });

                    // 回传到后端 (图片+视频一起更新)
                    if (mediaData.images.length > 0 || mediaData.videos.length > 0) {
                        const updateUrl = this.BACKEND_API_URL.replace('/save', '/updateMedia');
                        await axios.put(updateUrl, {
                            scraperId: post.scraperId,
                            images: JSON.stringify(mediaData.images),
                            videos: JSON.stringify(mediaData.videos),
                            videoUrl: mediaData.videoUrl
                        });
                        refreshed++;
                        log(`✅ [${i + 1}] 成功刷新 ${mediaData.images.length} 张图片, ${mediaData.videos.length} 条视频流`);
                    } else {
                        log(`⚠️ [${i + 1}] 未提取到媒体数据`);
                    }
                } catch (e) {
                    log(`❌ [${i + 1}] 刷新失败: ${e.message}`);
                } finally {
                    await newPage.close().catch(() => { });
                }
                // 防风控
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
            }

            await browser.disconnect();
        } catch (error) {
            if (browser) await browser.disconnect().catch(() => { });
            log(`刷新任务异常: ${error.message}`);
            return { success: false, msg: error.message, refreshed };
        }

        log(`视频链接刷新完成！成功刷新 ${refreshed}/${pendingPosts.length} 条。`);
        return { success: true, msg: `成功刷新 ${refreshed} 条`, refreshed };
    }
    /**
     * 实现用户需求：采集时同步媒体到后端 (转 PNG + 托管)
     */
    async _transformMediaFiles(item, page, log) {
        // 1. 处理图片 (转 PNG)
        if (item.images) {
            try {
                const images = JSON.parse(item.images);
                for (let i = 0; i < images.length; i++) {
                    const img = images[i];
                    const rawUrl = img.urlDefault || img.url || (typeof img === 'string' ? img : '');
                    if (rawUrl && rawUrl.startsWith('http')) {
                        log(`正在同步第 ${i + 1} 张图片并转 PNG 至后端...`);
                        let localPath = await ScraperAutomation.downloadResource(rawUrl, 'scrape_img', log, page);
                        // 调用 restyle 的标准化逻辑：统一 PNG
                        localPath = await ScraperAutomation.standardizeImage(localPath, log);
                        const ossUrl = await ScraperAutomation.uploadToOSS(localPath);
                        images[i].urlDefault = ossUrl;
                        images[i].urlPre = ossUrl;
                    }
                }
                item.images = JSON.stringify(images);
            } catch (e) { log(`图片流同步异常: ${e.message}`, 'error'); }
        }

        // 2. 处理视频 (托管高清版)
        if (item.videoUrl || item.videos) {
            try {
                const videos = JSON.parse(item.videos || '[]');
                const targetUrl = item.videoUrl || (videos.length > 0 ? videos[0].url : '');

                if (targetUrl && targetUrl.startsWith('http')) {
                    log(`正在同步最高画质视频素材至后端托管服务 (无水印原片)...`);
                    let localPath = await ScraperAutomation.downloadResource(targetUrl, 'scrape_vid', log, page);
                    const ossUrl = await ScraperAutomation.uploadToOSS(localPath);

                    // 更新所有视频流中的链接为 OSS 托管链接
                    if (videos.length > 0) {
                        videos.forEach(v => v.url = ossUrl);
                        item.videos = JSON.stringify(videos);
                    }
                    item.videoUrl = ossUrl;
                }
            } catch (e) { log(`视频流同步异常: ${e.message}`, 'error'); }
        }
    }
}

export default new ScraperManager();
