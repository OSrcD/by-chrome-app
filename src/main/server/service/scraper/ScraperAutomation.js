
import puppeteer from 'puppeteer';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import sharp from "sharp";
import logger from '../../../logger/logger.js';
import FormData from 'form-data';
import WindowService from '../WindowService.js';

class ScraperAutomation {
    constructor() {
        // this.BACKEND_URL = 'http://localhost:8080';
        this.BACKEND_URL = 'http://admin.ruoyivueplus.wulynk.com:8700/prod-api';
        this.browser = null;
        this.lastPort = null;
    }

    async init(port, log) {
        const targetPort = Number(port || 9223);

        /* 自动聚焦对应的浏览器窗口
        try {
            if (log) log(`[窗口聚焦] 正在切换至浏览器环境 (端口: ${targetPort})...`);
            await WindowService.focusWindow(targetPort);
        } catch (e) {
            logger.warn(`聚焦窗口失败: ${e.message}`);
        } */

        if (this.browser && this.browser.isConnected() && this.lastPort === targetPort) return;
        try {
            this.browser = await puppeteer.connect({
                browserURL: `http://127.0.0.1:${targetPort}`,
                defaultViewport: null
            });
            this.lastPort = targetPort;
        } catch (e) {
            throw new Error(`连接浏览器端口 ${targetPort} 失败，请确认该环境已启动`);
        }
    }

    async getPage(port, log) {
        await this.init(port, log);
        const pages = await this.browser.pages();
        let page = pages.find(p => p.url().includes('gemini.google.com'));
        /* if (!page) {
            page = await this.browser.newPage();
            await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
        } else {
            // await page.bringToFront();
        } */
        if (!page) {
            page = await this.browser.newPage();
            await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
        }
        return page;
    }

    /**
     * A. 独立文案重写
     */
    async executeRewriteText(post, templates, port, onLog) {
        const log = (msg) => { logger.info(`[RewriteText] ${msg}`); if (onLog) onLog(msg); };
        const page = await this.getPage(port, log);

        log('--- 启动独立文案重写任务 (重新建立对话) ---');
        await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2000));

        const rewritePrompt = templates.rewrite
            .replace('{{title}}', post.title || '')
            .replace('{{content}}', post.content || '');

        const initialCount = await this.sendToGemini(page, rewritePrompt, log);
        const rewriteText = await this.waitForGeminiResponse(page, initialCount, true);
        const rewriteResult = JSON.parse(this.extractJson(rewriteText));

        const versions = JSON.parse(post.restyleInfo || '[]');
        const newVersion = {
            version: versions.length + 1,
            title: rewriteResult.rewritten_title,
            content: rewriteResult.rewritten_content,
            images: [],
            videoUrl: '',
            status: 'Drafting',
            createTime: new Date().toLocaleString()
        };

        versions.push(newVersion);
        await this.persistToBackend(post.scraperId, versions, post);
        log(`[任务完成] 新版本文案已生成。`);
        return { success: true, versions };
    }

    /**
     * B. 独立图片复刻 (支持自定义提示词与参考源选择)
     * @param {Object} options { customPrompt: '用户补充提示', sourceUrl: '指定参考图URL' }
     */
    async executeRestyleImage(post, versionIndex, imageIndex, templates, port, onLog, options = {}) {
        const log = (msg) => { logger.info(`[RestyleImage] ${msg}`); if (onLog) onLog(msg); };
        const page = await this.getPage(port, log);

        log(`--- 启动图片复刻任务: 第 ${imageIndex + 1} 张 (重新建立对话) ---`);
        await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2000));

        const versions = JSON.parse(post.restyleInfo || '[]');
        if (!versions[versionIndex]) throw new Error('版本数据不匹配，请刷新页面');

        // 核心：确定参考源。优先使用 options 传入的地址（如已复刻的图），默认使用原图
        let imgUrl = options.sourceUrl;
        if (!imgUrl) {
            const originalImages = JSON.parse(post.images || '[]');
            const item = originalImages[imageIndex];
            imgUrl = item.urlDefault || item.url || (typeof item === 'string' ? item : '');
        }

        if (!imgUrl) throw new Error('参考源图片 URL 为空');

        const isPure = options.sourceMode?.endsWith('_pure');

        const isReferenceResyled = imgUrl && imgUrl.includes('oss');
        log(`[素材下载] 正在同步参考源 (${isReferenceResyled ? 'AI复刻图' : '原图'})...`);
        let localPath = await this.downloadResource(imgUrl, 'one_img', log, page);
        localPath = await this.standardizeImage(localPath, log);

        let finalPrompt = '';
        if (!isPure) {
            // 智能模式：需要先在普通聊天框上传并分析
            log(`[AI分析] 正在上传参考图提取特征...`);
            await this.pasteFromClipboard(page, log, localPath);
            const count1 = await this.sendToGemini(page, templates.analyze, log);
            await this.waitForGeminiResponse(page, count1, true);

            // 3. 生成提示词建议
            log(`[AI规划] 正在构造复刻方案...`);
            const count2 = await this.sendToGemini(page, templates.restyle, log);
            const restyleResp = await this.waitForGeminiResponse(page, count2, true);
            finalPrompt = JSON.parse(this.extractJson(restyleResp)).final_prompt;
        }

        // 4. 正式绘图
        log(`[AI绘图] 启动绘图引擎并载入素材...`);
        await this.selectGeminiMode(page, 'Create image');

        // 4.1 载入主参考图
        log(`[素材投放] 正在载入主参考图...`);
        await this.pasteFromClipboard(page, log, localPath);
        await new Promise(r => setTimeout(r, 1000)); // 留出上传缓冲

        // 4.2 处理额外的素材库参考图 (根据勾选顺序并列上传)
        if (options.extraMaterials && options.extraMaterials.length > 0) {
            log(`[素材投放] 正在追加载入素材库参考图 (按顺序 ${options.extraMaterials.length}张)...`);
            for (const matUrl of options.extraMaterials) {
                let localMat = await this.downloadResource(matUrl, 'mat_ref', log, page);
                localMat = await this.standardizeImage(localMat, log);
                const nMat = nativeImage.createFromPath(localMat);
                await this.pasteFromClipboard(page, log, localMat);
                log(`[已投放] 追加图: ${matUrl.substring(matUrl.lastIndexOf('/') + 1)}`);
                await new Promise(r => setTimeout(r, 1000)); // 留出上传缓冲
            }
        }

        // 4.3 核心：构造最终组合提示词并发送
        const userPromptSnippet = options.customPrompt ? `\n\n${options.customPrompt}` : "";
        let enhancedPrompt = "";

        if (isPure) {
            if (!options.customPrompt) throw new Error('“纯文生图”模式下必须输入自定义提示词');
            enhancedPrompt = `请根据我上传的多个参考图，严格按照以下要求生成图片（不要输出任何文字，必须直接绘图）：\n\n${options.customPrompt}`;
        } else {
            enhancedPrompt = `请根据上传的参考图和下面的提示词生成图片（不要输出任何文字，必须帮我生成图片）：\n\n${finalPrompt}${userPromptSnippet}`;
        }

        const count3 = await this.sendToGemini(page, enhancedPrompt, log);
        const restyledImgUrl = await this.waitForGeminiImage(page, count3);

        // 5. OSS资源入库
        log(`[资源入库] 正在同步复刻结果到云端...`);
        let localRestyled = await this.downloadResource(restyledImgUrl, 'restyled_one', log, page);
        localRestyled = await this.standardizeImage(localRestyled, log);
        const ossUrl = await this.uploadToOSS(localRestyled);

        // 同步内存数据并持久化 (记录历史以支持撤回)
        if (!versions[versionIndex].images) versions[versionIndex].images = [];
        const existingImg = versions[versionIndex].images.find(i => i.originalIndex === imageIndex);
        if (existingImg) {
            // 只有当当前有值且与新值不同时，才记录历史
            if (existingImg.url && existingImg.url !== ossUrl) {
                existingImg.prevUrl = existingImg.url;
            }
            existingImg.url = ossUrl;
        } else {
            versions[versionIndex].images.push({ originalIndex: imageIndex, url: ossUrl });
        }

        await this.persistToBackend(post.scraperId, versions, post);
        log(`[任务完成] 第 ${imageIndex + 1} 张图片复刻入库。`);
        return { success: true, versions };
    }

    /**
     * C. 独立视频复刻 (针对特定版本的全量视频生成)
     */
    async executeRestyleVideo(post, versionIndex, templates, port, onLog, options = {}) {
        const log = (msg) => { logger.info(`[RestyleVideo] ${msg}`); if (onLog) onLog(msg); };
        const page = await this.getPage(port, log);

        log(`--- 启动视频复刻合成任务 (重新建立对话) ---`);
        await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2000));

        const versions = JSON.parse(post.restyleInfo || '[]');
        const ver = versions[versionIndex];
        if (!ver) throw new Error('复刻版本已丢失');

        log(`[素材准备] 正在筛选已复刻的图片成果 (取前 3 张) 至 AI 工作区...`);
        // 策略：过滤掉尚未完成复刻（url 为空）的占位符，仅取前 3 张已生成的成果图
        const targetImages = (ver.images || []).filter(img => !!img.url).slice(0, 3);
        for (const imgObj of targetImages) {
            if (!imgObj.url) continue;
            let localImg = await this.downloadResource(imgObj.url, 'v_batch', log, page);
            localImg = await this.standardizeImage(localImg, log);
            await this.pasteFromClipboard(page, log, localImg);
        }

        // 处理额外素材库参考图 (针对视频)
        if (options.extraMaterials && options.extraMaterials.length > 0) {
            log(`[强化参考] 正在载入素材库中的额外视频参考图 (${options.extraMaterials.length} 张)...`);
            for (const matUrl of options.extraMaterials) {
                let localMat = await this.downloadResource(matUrl, 'mat_v_ref', log, page);
                localMat = await this.standardizeImage(localMat, log);
                const nMat = nativeImage.createFromPath(localMat);
                clipboard.writeImage(nMat);
                await this.pasteFromClipboard(page, log, localMat);
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        log(`[AI制作] 正在执行视频合成指令 (Create video)...`);
        await this.selectGeminiMode(page, 'Create video');

        const userPromptSnippet = options.customPrompt ? `\n\n${options.customPrompt}` : "";
        const videoPrompt = templates.video
            .replace('{{title}}', ver.title)
            .replace('{{content}}', ver.content) + userPromptSnippet;

        const countV = await this.sendToGemini(page, videoPrompt, log);
        const videoResourceUrl = await this.waitForGeminiVideo(page, countV);
        const localVideo = await this.downloadResource(videoResourceUrl, 'video_one', log, page);
        const videoOssUrl = await this.uploadToOSS(localVideo);

        // 记录历史
        if (ver.videoUrl && ver.videoUrl !== videoOssUrl) {
            ver.prevVideoUrl = ver.videoUrl;
        }
        ver.videoUrl = videoOssUrl;
        ver.status = 'Success';
        await this.persistToBackend(post.scraperId, versions, post);

        log(`[任务完成] 视频合成成功。`);
        return { success: true, versions };
    }

    /**
     * D. 链式全量一键复刻 (支持批量自定义参数)
     * @param {Object} batchOptions { customPrompt: '全局补充提示词' }
     */
    async executeFullRestyle(post, templates, port, onLog, batchOptions = {}) {
        // 重新定义的"一键复刻"：通过串联模块化步骤实现，每一步都重新登录对话环境
        const log = (msg) => { logger.info(`[Full-Auto] ${msg}`); if (onLog) onLog(msg); };
        log('>>> 开始链式全量复刻 (模块化拆解任务队列) <<<');

        // 1. 文案重写 (生成新 Version 容器)
        const textRes = await this.executeRewriteText(post, templates, port, onLog);
        const targetVidx = textRes.versions.length - 1;

        // 2. 图片逐张复刻 (透传批量参数)
        const originalImages = JSON.parse(post.images || '[]');
        for (let i = 0; i < originalImages.length; i++) {
            await this.executeRestyleImage(post, targetVidx, i, templates, port, onLog, {
                customPrompt: batchOptions.customPrompt,
                extraMaterials: batchOptions.extraMaterials // 透传素材库图片
            });
        }

        // 3. 视频合成 (已按需求改为手动触发，不再自动执行)
        // await this.executeRestyleVideo(post, targetVidx, templates, port, onLog);

        log('>>> 链式全量复刻任务全部圆满结束 <<<');
        const finalVersions = JSON.parse(post.restyleInfo || '[]'); // 获取最终版
        return { success: true, versions: finalVersions };
    }

    /**
     * E. 撤回上一步操作 (图片/视频)
     */
    async executeUndoRestyle(post, versionIndex, type, imageIndex = 0) {
        const versions = JSON.parse(post.restyleInfo || '[]');
        const ver = versions[versionIndex];
        if (!ver) throw new Error('版本不存在');

        if (type === 'image') {
            const img = ver.images.find(i => i.originalIndex === imageIndex);
            if (!img || !img.prevUrl) throw new Error('没有可撤回的历史记录');

            // 交换当前与历史 (可以反向撤回)
            const current = img.url;
            img.url = img.prevUrl;
            img.prevUrl = current;
        } else if (type === 'video') {
            if (!ver.prevVideoUrl) throw new Error('没有可撤回的视频历史');
            const current = ver.videoUrl;
            ver.videoUrl = ver.prevVideoUrl;
            ver.prevVideoUrl = current;
        }

        await this.persistToBackend(post.scraperId, versions, post);
        return { success: true, versions };
    }

    // --- 核心动作实现 ---

    async downloadResource(url, prefix, log, page) {
        const tempDir = path.join(app.getPath('userData'), 'temp_scraper');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const isVideo = url.includes('.mp4') || url.includes('video') || (prefix && prefix.includes('vid'));
        const fileName = `${prefix}_${Date.now()}${isVideo ? '.mp4' : '.webp'}`;
        const filePath = path.resolve(tempDir, fileName);

        try {
            // 增强逻辑：针对 blob 协议、Google 受保护链接或所有视频，优先使用浏览器上下文提取
            const isGoogleResource = url.includes('googleusercontent.com') || url.includes('google.com');

            if (url.startsWith('blob:') && page) {
                log(`[内存提取] 正在转换内核 Blob 资源 (受保护/动态流: ${isVideo ? '视频' : '图片'})...`);
                const base64Data = await page.evaluate(async (targetUrl, isVid) => {
                    // 策略 1: 如果是图片且是 blob，优先 Canvas (兼容图片)
                    if (!isVid && targetUrl.startsWith('blob:')) {
                        try {
                            const img = new Image();
                            img.src = targetUrl;
                            await new Promise((resolve, reject) => {
                                img.onload = resolve;
                                img.onerror = () => reject('LoadImageError');
                                setTimeout(() => reject('Timeout'), 10000);
                            });
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0);
                            return canvas.toDataURL('image/png').split(',')[1];
                        } catch (e) {
                            console.warn('Canvas capture failed, trying direct fetch:', e);
                        }
                    }

                    // 策略 2: 统一 Fetch (仅适用于 blob)
                    try {
                        const response = await fetch(targetUrl);
                        const blob = await response.blob();
                        return new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result.split(',')[1]);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                    } catch (e) {
                        throw new Error(`内核 Fetch 同步失败: ${e.message}`);
                    }
                }, url, isVideo);

                fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
            } else if (page && (isGoogleResource || isVideo)) {
                log(`[会话透传] 检测到受保护资源，正在同步浏览器 Cookie 会话并建立 HTTP 连接...`);
                // 核心：从浏览器提取 Cookie 并透传给 Node 端 axios，绕过浏览器的 CORS 限制
                const cookies = await page.cookies();
                const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

                const response = await axios({
                    url,
                    method: 'GET',
                    responseType: 'stream',
                    timeout: 60000,
                    headers: {
                        'User-Agent': await page.evaluate(() => navigator.userAgent),
                        'Cookie': cookieStr,
                        'Referer': url.includes('xhscdn.com') || url.includes('xiaohongshu.com') ? 'https://www.xiaohongshu.com/' : 'https://gemini.google.com/',
                        'Accept': '*/*'
                    }
                });

                if (response.status !== 200) throw new Error(`HTTP状态码异常: ${response.status}`);

                const writer = fs.createWriteStream(filePath);
                response.data.pipe(writer);
                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
                log(`[透传同步完成] 资源已持久化: ${filePath}`);
            } else {
                log(`[HTTP下载] 正在执行外部网关同步: ${url.substring(0, 50)}...`);
                // 对于非私有的外部链接 (如小红书原图)，继续使用 axios，效率更高
                const response = await axios({
                    url,
                    method: 'GET',
                    responseType: 'stream',
                    timeout: 45000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Referer': 'https://www.xiaohongshu.com/',
                        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                    }
                });

                if (response.status !== 200) throw new Error(`HTTP状态码异常: ${response.status}`);

                const writer = fs.createWriteStream(filePath);
                response.data.pipe(writer);
                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
            }

            if (fs.existsSync(filePath)) {
                const stat = fs.statSync(filePath);
                log(`[同步完成] 资源已持久化到磁盘: ${(stat.size / 1024).toFixed(1)} KB`);
                return filePath;
            }
            throw new Error('素材文件检出失败');
        } catch (e) {
            log(`[素材同步失败!] 地址: ${url.substring(0, 60)}..., 详情: ${e.message}`);
            throw e;
        }
    }

    /**
     * 图片标准化：将 WebP/AVIF 等各种格式统一转为标准 PNG，解决 NativeImage 加载兼容性
     */
    async standardizeImage(localPath, log) {
        // 如果是视频，直接跳过
        if (localPath.endsWith('.mp4')) return localPath;

        try {
            const outPath = localPath.replace(/\.[^/.]+$/, "") + "_standard.png";
            log(`[格式标准化] 正在读取素材并转码...`);

            // 1. 将文件读入内存 Buffer，避免文件句柄被 sharp 占用导致无法删除原文件
            const inputBuffer = fs.readFileSync(localPath);

            // 2. 使用 sharp 内存转码并输出为标准的 PNG
            await sharp(inputBuffer).png().toFile(outPath);

            // 3. 安全删除原文件 (此时 localPath 不再被任何进程占用)
            if (fs.existsSync(localPath)) fs.unlinkSync(localPath);

            log(`[标准化完成] 输出路径: ${outPath}`);
            return outPath;
        } catch (e) {
            log(`[标准化失败] sharp 处理异常，将尝试使用原图: ${e.message}`);
            return localPath;
        }
    }

    async sendToGemini(page, text, log) {
        if (log) log(`[指令投递] 准备发送 Prompt (长度: ${text.length}): "${text.substring(0, 80).replace(/\n/g, ' ')}..."`);

        const selector = 'div[contenteditable="true"], textarea, [role="textbox"]';
        await page.waitForSelector(selector);

        // 发送前记录消息总数
        const initialCount = await page.evaluate(() => document.querySelectorAll('model-response').length);

        await page.evaluate((sel, t) => {
            const el = document.querySelector(sel);
            if (!el) return;
            el.focus();
            // 优先使用 execCommand 以模拟真实输入流
            if (!document.execCommand('insertText', false, t)) {
                if (el.tagName === 'DIV' || el.hasAttribute('contenteditable')) el.innerText = t;
                else el.value = t;
            }
            // 触发一系列事件以确保应用层识别到变化
            ['input', 'change', 'blur', 'focus'].forEach(type => {
                el.dispatchEvent(new Event(type, { bubbles: true }));
            });
        }, selector, text);

        // 给 UI 留一点同步时间
        await new Promise(r => setTimeout(r, 1000));

        try {
            // 针对 Gemini 优化的选择器优先序列
            const sendBtnSelector = [
                'button.send-button:not([disabled])',
                'button.submit:not([disabled])',
                'button[aria-label*="Send message"]:not([aria-disabled="true"])',
                'button[aria-label*="发送"]:not([aria-disabled="true"])'
            ].join(', ');

            if (log) log(`[发送检查] 正在监测发送按钮状态...`);

            await page.waitForFunction((sel) => {
                const btn = document.querySelector(sel);
                if (!btn) return false;
                const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
                return !isDisabled;
            }, { timeout: 30000 }, sendBtnSelector);

            if (log) log(`[发送就绪] 按钮已激活，执行复合点击序列...`);

            // 模拟完整的鼠标点击序列，处理可能的层级拦截
            const sendSuccess = await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (!btn) return false;
                
                btn.focus();
                const events = ['pointerdown', 'mousedown', 'click', 'mouseup', 'pointerup'];
                events.forEach(type => {
                    btn.dispatchEvent(new MouseEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        buttons: 1
                    }));
                });
                return true;
            }, sendBtnSelector);

            if (sendSuccess) {
                // 验证发送结果：如果输入框在 3 秒内没清空，说明没点中或没触发
                await new Promise(r => setTimeout(r, 2000));
                const isCleared = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    return el ? (el.innerText || el.value || "").trim() === "" : true;
                }, selector);

                if (!isCleared) {
                    if (log) log(`[发送补救] 文本未清空，执行物理 Enter 提交...`);
                    await page.keyboard.press('Enter');
                }
            } else {
                await page.keyboard.press('Enter');
            }
        } catch (e) {
            if (log) log(`[发送异常] 流程受阻，尝试 Enter 强制提交: ${e.message}`);
            await page.keyboard.press('Enter');
        }

        if (log) log(`[对话提交] 提交指令已下发，等待响应中...`);
        return initialCount;
    }

    async pasteFromClipboard(page, log, filePath = null) {
        if (log) log(`[粘贴动作] 正在执行后台数据投放 (路径: ${filePath ? '自定义文件' : '系统剪贴板'})...`);

        const selector = 'div[contenteditable="true"], textarea, [role="textbox"]';
        await page.waitForSelector(selector);

        if (filePath && fs.existsSync(filePath)) {
            // 背景任务核心：不依赖系统剪贴板，直接读取文件转 base64 并在页面内模拟 paste 事件
            const buffer = fs.readFileSync(filePath);
            const base64 = buffer.toString('base64');
            const fileName = path.basename(filePath);
            const mimeType = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

            await page.evaluate(async (b64, type, name, sel) => {
                const el = document.querySelector(sel);
                if (!el) return;

                // 构造 File 对象
                const res = await fetch(`data:${type};base64,${b64}`);
                const blob = await res.blob();
                const file = new File([blob], name, { type });

                // 构造 DataTransfer
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);

                // 触发 paste 事件
                const event = new ClipboardEvent('paste', {
                    clipboardData: dataTransfer,
                    bubbles: true,
                    cancelable: true
                });
                
                el.focus();
                el.dispatchEvent(event);
                
                // 辅助：触发 input 事件确保 UI 更新
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }, base64, mimeType, fileName, selector);

            if (log) log(`[投放完成] 文件数据已注入浏览器内核。`);
        } else {
            // 兜底方案：物理粘贴 (依然尽量后台化处理)
            await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el) el.focus();
            }, selector);
            await page.keyboard.down('Control');
            await page.keyboard.press('V');
            await page.keyboard.up('Control');
        }

        await new Promise(r => setTimeout(r, 2500)); // 缩短等待，数据注入比物理加载快
    }

    async selectGeminiMode(page, modeName) {
        // 1. 寻找核心功能按钮：明确寻找带有 "Tools" 文本或 "Tools" aria-label 的按钮
        const pickerHandle = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(b => {
                const label = b.getAttribute('aria-label') || "";
                const text = b.innerText || "";
                // 排除顶部模型选择器 (Gemini 1.5 Flash 等)，寻找带有 "Tools" 或 "Add-ons" 的底部按钮
                return (text.includes('Tools') || label.includes('Tools')) && b.getAttribute('aria-haspopup') === 'menu';
            });
        });

        const picker = pickerHandle.asElement();
        if (picker) {
            // 2. 检查菜单是否已展开
            const isExpanded = await page.evaluate(el => el.getAttribute('aria-expanded') === 'true', picker);
            if (!isExpanded) {
                await picker.click();
                await new Promise(r => setTimeout(r, 1000));
            }

            // 3. 在菜单中切换至目标工具模式
            await page.evaluate((name) => {
                const items = Array.from(document.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"], [role="option"]'));
                const item = items.find(i => (i.innerText || "").includes(name));
                if (item) {
                    // 仅在当前未被选中的情况下才执行点击
                    const isChecked = item.getAttribute('aria-checked') === 'true' || item.getAttribute('aria-selected') === 'true';
                    if (!isChecked) {
                        item.click();
                    } else {
                        // 如果已经选中了，直接关闭菜单即可 (点击 picker 或按 Esc，为了稳健点击空白区域或再点一下 picker)
                        // 此时无需操作。
                    }
                }
            }, modeName);

            // 确保菜单由于可能的手动点击或其他操作后关闭，为输入让路
            await new Promise(r => setTimeout(r, 1500));
        } else {
            logger.warn(`[ScraperAutomation] 未找到 "Tools" 模式选择器按钮`);
        }
    }

    /**
     * 增强版：等待 AI 响应完成 (结合物理状态锁和内容验证)
     * @param {Page} page 
     * @param {Boolean} expectJson 是否需要等待包含 JSON 结构
     */
    async waitForGeminiResponse(page, initialCount = 0, expectJson = false) {
        // 1. 先等待新响应元素的出现 (数量比发送前多)
        logger.info(`[ScraperAutomation] 正在等待新响应容器初始化 (当前计数: ${initialCount})...`);
        await page.waitForFunction((count) => {
            return document.querySelectorAll('model-response').length > count;
        }, { timeout: 90000 }, initialCount);

        let lastLength = 0;
        let stabilityCount = 0;
        const maxStability = 5; 

        logger.info(`[ScraperAutomation] 探测到新消息，开始监听生成流 (JSON预期: ${expectJson})...`);

        for (let i = 0; i < 90; i++) {
            const state = await page.evaluate(() => {
                const list = document.querySelectorAll('model-response');
                const lastIdx = list.length - 1;
                // 仅抓取最后一个容器的内容，避免历史干扰
                const content = lastIdx >= 0 ? list[lastIdx].innerText : "";

                const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"], button[aria-label*="Interrupt"]');
                const isStillGenerating = !!stopBtn;

                return { content, isStillGenerating };
            });

            const currentLength = state.content.length;
            const hasJsonStructure = state.content.includes('{') && state.content.includes('}');

            let finished = false;
            if (!state.isStillGenerating && currentLength > 0 && currentLength === lastLength) {
                stabilityCount++;
                if (stabilityCount >= maxStability) {
                    if (expectJson) {
                        if (hasJsonStructure) finished = true;
                        else if (stabilityCount > 15) finished = true;
                    } else {
                        finished = true;
                    }
                }
            } else {
                stabilityCount = 0;
            }

            if (finished) {
                logger.info(`[ScraperAutomation] 生成流判定结束 (字数: ${currentLength})`);
                return state.content;
            }

            lastLength = currentLength;
            await new Promise(r => setTimeout(r, 1000));
        }

        throw new Error('AI 长时间未完成响应或输出被意外阻塞');
    }

    async waitForGeminiImage(page, initialCount = 0) {
        // 等待新消息容器
        await page.waitForFunction((count) => {
            return document.querySelectorAll('model-response').length > count;
        }, { timeout: 90000 }, initialCount);

        await page.waitForSelector('model-response img', { timeout: 240000 });

        for (let i = 0; i < 30; i++) {
            const src = await page.evaluate(() => {
                const imgs = document.querySelectorAll('model-response img');
                const lastImg = imgs[imgs.length - 1];
                if (!lastImg) return null;
                const s = lastImg.src;
                if (!s || s.length < 5 || s.startsWith('data:image/svg')) return null;
                return s;
            });

            if (src) {
                await new Promise(r => setTimeout(r, 2000));
                return src;
            }
            await new Promise(r => setTimeout(r, 2000));
        }

        throw new Error('生成的图片地址解析超时或内容无效');
    }

    async waitForGeminiVideo(page, initialCount = 0) {
        await page.waitForFunction((count) => {
            return document.querySelectorAll('model-response').length > count;
        }, { timeout: 90000 }, initialCount);

        await page.waitForSelector('video, a[href*="video"]', { timeout: 210000 });
        return await page.evaluate(() => {
            const v = document.querySelector('video');
            if (v) return v.src;
            const a = document.querySelector('a[href*="video"]');
            return a ? a.href : null;
        });
    }

    extractJson(text) {
        // 去除 Markdown 代码块标签
        let clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const match = clean.match(/\{[\s\S]*\}/);
        return match ? match[0] : clean;
    }

    async uploadToOSS(filePath) {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath));
        try {
            const res = await axios.post(`${this.BACKEND_URL}/resource/oss/upload`, formData, {
                headers: formData.getHeaders()
            });
            if (res.data.code === 200) return res.data.data.url;
            throw new Error(res.data.msg);
        } catch (e) {
            logger.error('[OSS] 上传失败: ' + e.message);
            throw e;
        } finally {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
    }

    async persistToBackend(scraperId, versions, postObj = null) {
        const jsonStr = JSON.stringify(versions);
        try {
            await axios.put(`${this.BACKEND_URL}/business/scraper/updateRestyle`, {
                scraperId: scraperId,
                restyleInfo: jsonStr
            });
            if (postObj) postObj.restyleInfo = jsonStr; // 同步内存对象
        } catch (e) {
            logger.error('[DB] 持久化失败: ' + e.message);
        }
    }

    async testVideoDownload(url, port) {
        const page = await this.getPage(port);
        logger.info(`[Test] 启动视频下载独立测试: ${url}`);
        const resultPath = await this.downloadResource(url, 'test_manual', (msg) => logger.info(`[TestLog] ${msg}`), page);
        return resultPath;
    }
}

export default new ScraperAutomation();
