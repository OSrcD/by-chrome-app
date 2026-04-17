import puppeteer from 'puppeteer';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { app, nativeImage, clipboard } from 'electron';
import FormData from 'form-data';
import sharp from 'sharp';
import logger from '../../logger/logger.js';

/**
 * Gemini 自动化基础服务类
 * 提供经过稳定性加固的底层交互方法
 */
class GeminiCommonAutomation {
    constructor() {
        this.BACKEND_URL = 'http://localhost:8080';
        this.browser = null;
        this.lastPort = null;
    }

    async init(port, log) {
        const targetPort = Number(port || 9223);
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
        if (!page) {
            page = await this.browser.newPage();
            await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
        }
        return page;
    }

    async createNewChat(page, log) {
        if (log) log(`[对话重置] 正在重定向至全新对话窗口...`);
        try {
            await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 2000));
            await page.evaluate(() => {
                const selectors = ['button[aria-label*="New chat"]', 'button[aria-label*="新对话"]', 'a[href="/app"]'];
                for (const sel of selectors) {
                    const btn = document.querySelector(sel);
                    if (btn) { btn.click(); return; }
                }
                const allBtns = Array.from(document.querySelectorAll('button, a'));
                const newChatBtn = allBtns.find(b => {
                    const t = (b.innerText || "").toLowerCase();
                    return t.includes('new chat') || t.includes('新对话');
                });
                if (newChatBtn) newChatBtn.click();
            });
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            if (log) log(`[对话重置] 警告: 重置跳转可能失败: ${e.message}`);
        }
    }

    async clearGeminiInput(page, log) {
        if (log) log(`[清理] 正在强制清空输入框与残留附件...`);
        const selector = 'div[contenteditable="true"], textarea, [role="textbox"]';
        try {
            await page.focus(selector);
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            
            await page.evaluate(() => {
                const removeSelectors = ['button[aria-label*="Remove"]', 'button[aria-label*="移除"]', '.upload-chip-remove-button'];
                removeSelectors.forEach(sel => Array.from(document.querySelectorAll(sel)).forEach(btn => btn.click()));
                Array.from(document.querySelectorAll('mat-icon[role="button"]')).forEach(icon => {
                    if ((icon.innerText || "").toLowerCase().includes('close')) icon.click();
                });
            });
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            if (log) log(`[清理] 警告: 清场操作未完全成功: ${e.message}`);
        }
    }

    async isInputCleared(page) {
        const selector = 'div[contenteditable="true"], textarea, [role="textbox"]';
        return await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return true;
            const text = (el.innerText || el.value || "").trim();
            const hasChips = !!document.querySelector('button[aria-label*="Remove"], button[aria-label*="移除"]');
            return text === "" && !hasChips;
        }, selector);
    }

    async isGenerating(page) {
        return await page.evaluate(() => {
            const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"]');
            const indicators = Array.from(document.querySelectorAll('mat-progress-spinner, .generating-indicator, [role="progressbar"]'));
            const isSpinning = indicators.some(el => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0;
            });
            const hasActionButtons = !!document.querySelector('button[aria-label="Copy response"]');
            return (!!stopBtn || isSpinning) && !hasActionButtons;
        });
    }

    async waitForIdle(page, log, timeout = 90000) {
        if (log) log(`[等待空闲] 正在检查 AI 是否忙碌...`);
        try {
            await page.waitForFunction(() => {
                const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"]');
                const indicators = Array.from(document.querySelectorAll('mat-progress-spinner, .generating-indicator, [role="progressbar"]'));
                const isSpinning = indicators.some(el => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0;
                });
                return !stopBtn && !isSpinning;
            }, { timeout });
            if (log) log(`[空闲] AI 已就绪`);
        } catch (e) {
            if (log) log(`[警告] 等待 AI 空闲超时: ${e.message}`);
        }
    }

    async setTextToInput(page, text) {
        const selector = 'div[contenteditable="true"], textarea, [role="textbox"]';
        await page.waitForSelector(selector);
        await page.evaluate((sel, t) => {
            const el = document.querySelector(sel);
            if (!el) return;
            el.focus();
            if (!document.execCommand('insertText', false, t)) {
                if (el.tagName === 'DIV' || el.hasAttribute('contenteditable')) el.innerText = t;
                else el.value = t;
            }
            ['input', 'change', 'blur', 'focus'].forEach(type => el.dispatchEvent(new Event(type, { bubbles: true })));
        }, selector, text);
        await new Promise(r => setTimeout(r, 1000));
    }

    async sendToGemini(page, text, log) {
        if (log && text) log(`[指令投递] 准备发送 Prompt (长度: ${text.length})...`);
        const inputSelector = 'div[contenteditable="true"], textarea, [role="textbox"]';
        await page.waitForSelector(inputSelector);
        const initialCount = await this.getMessageCount(page);
        if (text !== "") await this.setTextToInput(page, text);

        try {
            const sendBtnSel = 'button.send-button:not([disabled]), button[aria-label*="Send"]:not([aria-disabled="true"]), button[aria-label*="发送"]:not([aria-disabled="true"])';
            if (log) log(`[发送检查] 监测发送按钮...`);
            await page.waitForFunction((sel) => {
                const btn = document.querySelector(sel);
                if (!btn) return false;
                const label = (btn.getAttribute('aria-label') || "").toLowerCase();
                const isStop = label.includes('stop') || label.includes('停止');
                return !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && !isStop;
            }, { timeout: 60000 }, sendBtnSel);

            await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (btn) btn.click();
            }, sendBtnSel);

            // 轮询等待发送成功 (清空或进入生成态)
            if (log) log(`[发送检查] 正在等待发送确认...`);
            let sendConfirmed = false;
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 500));
                if (await this.isInputCleared(page) || await this.isGenerating(page)) {
                    sendConfirmed = true;
                    break;
                }
            }

            if (!sendConfirmed) {
                if (log) log(`[发送补救] 尝试 Enter 补偿...`);
                await page.focus(inputSelector);
                await page.keyboard.press('Enter');
                // 再等一会确认
                for (let i = 0; i < 10; i++) {
                    await new Promise(r => setTimeout(r, 500));
                    if (await this.isInputCleared(page) || await this.isGenerating(page)) break;
                }
            }
        } catch (e) {
            if (log) log(`[发送异常] ${e.message}，尝试最终 Enter 补救`);
            await page.focus(inputSelector);
            await page.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 2000));
        }
        return initialCount;
    }

    async waitForGeminiTextResult(page, log, maxChecks = 120, initialCount) {
        let checks = 0;
        while (checks < maxChecks) {
            await new Promise(r => setTimeout(r, 5000));
            const status = await page.evaluate((init) => {
                const messages = document.querySelectorAll('message-content');
                const currentCount = messages.length;
                const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"]');
                const indicators = Array.from(document.querySelectorAll('mat-progress-spinner, .generating-indicator, [role="progressbar"]'));
                const isGenerating = !!stopBtn || indicators.some(el => el.offsetWidth > 0);
                const hasActionButtons = !!document.querySelector('button[aria-label="Copy response"]');

                if (currentCount > init || hasActionButtons) {
                    const lastMsg = messages[messages.length - 1];
                    if (lastMsg) {
                        const text = (lastMsg.innerText || "").trim();
                        // 结束判定：不处于生成中，且已有内容，或者出现了动作按钮
                        if ((!isGenerating && text.length > 5) || hasActionButtons) {
                            return { finished: true, text };
                        }
                    }
                }
                return { finished: false, isGenerating };
            }, initialCount);

            if (status.finished) {
                if (log) log(`[结果] 完成，字数: ${status.text.length}`);
                return status.text;
            }
            checks++;
        }
        throw new Error("等待响应超时");
    }

    async waitForGeminiImage(page, log, initialCount, maxChecks = 60) {
        let checks = 0;
        while (checks < maxChecks) {
            await new Promise(r => setTimeout(r, 5000));
            const imgUrl = await page.evaluate((init) => {
                const messages = document.querySelectorAll('message-content');
                if (messages.length > init) {
                    const lastMsg = messages[messages.length - 1];
                    const img = lastMsg.querySelector('img[src*="googleusercontent"], img[src^="blob:"]');
                    if (img && img.src) return img.src;
                }
                return null;
            }, initialCount);
            if (imgUrl) return imgUrl;
            checks++;
        }
        throw new Error("等待图片超时");
    }

    async waitForGeminiVideo(page, log, initialCount, maxChecks = 180) {
        let checks = 0;
        while (checks < maxChecks) {
            await new Promise(r => setTimeout(r, 10000));
            const videoUrl = await page.evaluate((init) => {
                const messages = document.querySelectorAll('message-content');
                if (messages.length > init) {
                    const lastMsg = messages[messages.length - 1];
                    const video = lastMsg.querySelector('video, source');
                    if (video && video.src) return video.src;
                    const img = lastMsg.querySelector('img[src^="blob:"]');
                    if (img && img.src) return img.src;
                }
                return null;
            }, initialCount);
            if (videoUrl) return videoUrl;
            checks++;
        }
        throw new Error("等待视频超时");
    }

    async getMessageCount(page) {
        return await page.evaluate(() => document.querySelectorAll('message-content').length);
    }

    async selectGeminiMode(page, modeName, log) {
        await page.evaluate(async (name) => {
            const picker = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || "").toLowerCase().includes('tools'));
            if (picker) {
                if (picker.getAttribute('aria-expanded') !== 'true') picker.click();
                await new Promise(r => setTimeout(r, 500));
                const item = Array.from(document.querySelectorAll('[role="menuitemcheckbox"], [role="option"]')).find(i => (i.innerText || "").includes(name));
                if (item && item.getAttribute('aria-checked') !== 'true') item.click();
            }
        }, modeName);
        await new Promise(r => setTimeout(r, 1500));
    }

    async pasteFile(page, filePath, log) {
        if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        const isVideo = filePath.toLowerCase().endsWith('.mp4');
        const type = isVideo ? 'video/mp4' : 'image/png';
        const name = path.basename(filePath);
        await page.evaluate(async (b64, t, n) => {
            const el = document.querySelector('div[contenteditable="true"], [role="textbox"]');
            const res = await fetch(`data:${t};base64,${b64}`);
            const blob = await res.blob();
            const file = new File([blob], n, { type: t });
            const dt = new DataTransfer();
            dt.items.add(file);
            el.focus();
            el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
        }, base64, type, name);
        await new Promise(r => setTimeout(r, isVideo ? 5000 : 2000));
    }

    async downloadFile(url, prefix = 'media_', log, page) {
        return await this.downloadResource(url, prefix, log, page);
    }

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

    async standardizeImage(filePath, log) {
        if (filePath.endsWith('.mp4')) return filePath;
        try {
            const outPath = filePath.replace(/\.[^/.]+$/, "") + "_std.png";
            await sharp(fs.readFileSync(filePath)).png().toFile(outPath);
            fs.unlinkSync(filePath);
            return outPath;
        } catch (e) {
            return filePath;
        }
    }

    async uploadToOSS(filepath, log) {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filepath));
        const res = await axios.post(`${this.BACKEND_URL}/resource/oss/upload`, formData, { headers: formData.getHeaders() });
        if (res.data && res.data.code === 200) return res.data.data.url;
        throw new Error(res.data.msg || 'OSS上传失败');
    }

    extractJson(text) {
        const match = text.match(/`{3}(?:json)?\s*([\s\S]*?)\s*`{3}/i);
        if (match) return match[1].trim();
        const f = text.indexOf('{'), l = text.lastIndexOf('}');
        return (f !== -1 && l !== -1) ? text.substring(f, l + 1) : text;
    }
}

export default GeminiCommonAutomation;
