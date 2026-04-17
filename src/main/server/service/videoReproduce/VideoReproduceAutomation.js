import GeminiCommonAutomation from '../GeminiCommonAutomation.js';
import fs from 'fs';
import path from 'path';

/**
 * 视频复刻自动化服务
 * 继承自 GeminiCommonAutomation，具备高稳定性交互基准
 */
class VideoReproduceAutomation extends GeminiCommonAutomation {
    constructor() {
        super();
    }

    /**
     * 执行洗图 (Wash Image) - 创作模式高级版
     * 支持：原图智能融合、复刻图二次加工、原图纯文生图、复刻图纯文生图
     */
    async executeWashImage(params, port, onLog) {
        const log = (msg) => { console.log(`[WashImage] ${msg}`); if (onLog) onLog(msg); };
        const page = await this.getPage(port, log);

        log(`--- 启动洗图任务 (创作模式模式: ${params.mode || '默认'}) ---`);
        await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 2000));

        const isPure = params.mode?.endsWith('_pure');
        const sourceUrl = params.sourceUrl;
        const charUrls = params.charUrls || [];
        const productUrls = params.productUrls || [];
        const extraMaterials = params.extraMaterials || [];
        const templates = params.templates || {};

        if (!sourceUrl) throw new Error('参考源图片 URL 为空');

        // 1. 同步素材 (主参考图 + 素材库额外参考图)
        log(`[素材同步] 正在准备所有参考素材...`);
        let mainLocalPath = await this.downloadFile(sourceUrl, 'main_ref_', log, page);
        mainLocalPath = await this.standardizeImage(mainLocalPath, log);

        const extraLocalPaths = [];
        const allRefUrls = [...charUrls, ...productUrls, ...extraMaterials];
        for (let i = 0; i < allRefUrls.length; i++) {
            if (!allRefUrls[i]) continue;
            let lp = await this.downloadFile(allRefUrls[i], `ref_material_${i}_`, log, page);
            lp = await this.standardizeImage(lp, log);
            extraLocalPaths.push(lp);
        }

        let finalPrompt = '';

        if (!isPure) {
            // ============ 智能模式：分析与规划阶段 ============
            
            // --- 阶段 A: AI 分析图片特征 ---
            let analyzeSuccess = false;
            for (let retry = 1; retry <= 3; retry++) {
                log(`[AI分析] 正在上传主图提取特征 (第 ${retry} 次尝试)...`);
                await this.clearGeminiInput(page, log);
                await this.pasteFile(page, mainLocalPath, log);
                
                const initCount = await this.getMessageCount(page);
                await this.sendToGemini(page, templates.analyze || '请分析这张图片的画面特征', log);
                
                if (await this.isInputCleared(page) || await this.isGenerating(page)) {
                    try {
                        await this.waitForGeminiTextResult(page, log, 120, initCount);
                        analyzeSuccess = true;
                        break;
                    } catch (e) {
                        log(`[分析失败] ${e.message}`);
                    }
                }
            }
            if (!analyzeSuccess) throw new Error("AI分析阶段多次重试后失败");

            // --- 阶段 B: AI 规划绘图方案 ---
            let planningSuccess = false;
            for (let retry = 1; retry <= 3; retry++) {
                log(`[AI规划] 正在构造复刻方案 (第 ${retry} 次尝试)...`);
                await this.clearGeminiInput(page, log);
                const initCount = await this.getMessageCount(page);
                await this.sendToGemini(page, templates.restyle || '请提供基于此图的绘图建议', log);

                if (await this.isInputCleared(page) || await this.isGenerating(page)) {
                    try {
                        const resp = await this.waitForGeminiTextResult(page, log, 120, initCount);
                        const jsonStr = this.extractJson(resp);
                        finalPrompt = JSON.parse(jsonStr).final_prompt;
                        if (!finalPrompt) throw new Error("未能提取出 final_prompt");
                        planningSuccess = true;
                        log(`[规划成功] 已获取最终绘图提示词`);
                        break;
                    } catch (e) {
                        log(`[规划失败] ${e.message}`);
                    }
                }
            }
            if (!planningSuccess) throw new Error("AI规划阶段多次重试后失败");
        }

        // ============ 正式绘图阶段 ============
        let creationSuccess = false;
        let ossUrl = "";

        // 根据用户要求，原图智能融合和复刻图二次加工在绘图前开启新对话
        if (!isPure) {
            await this.createNewChat(page, log);
        }

        for (let retry = 1; retry <= 3; retry++) {
            log(`[AI绘图] 启动绘图引擎 (第 ${retry} 次尝试)...`);
            await this.clearGeminiInput(page, log);
            await this.selectGeminiMode(page, 'Create image', log);

            // 投放素材 (主参考图 + 额外素材集群)
            log(`[素材投放] 正在载入参考素材 (共 ${1 + extraLocalPaths.length} 张)...`);
            await this.pasteFile(page, mainLocalPath, log);
            
            for (const ep of extraLocalPaths) {
                await this.pasteFile(page, ep, log);
            }
            log(`[素材投放] 素材上传完毕，共 ${1 + extraLocalPaths.length} 张`);
            await new Promise(r => setTimeout(r, 4000));

            // 合成提示词
            const userPromptSnippet = params.customPrompt ? `\n\n${params.customPrompt}` : "";
            let enhancedPrompt = "";
            if (isPure) {
                enhancedPrompt = `请根据我上传的多个参考图，严格按照以下要求生成图片：\n\n${params.customPrompt || '生成风格一致的图'}`;
            } else {
                enhancedPrompt = `请根据上传的参考图 and 下面的提示词生成图片：\n\n${finalPrompt}${userPromptSnippet}`;
            }

            const initCount = await this.getMessageCount(page);
            await this.sendToGemini(page, enhancedPrompt, log);

            if (await this.isInputCleared(page) || await this.isGenerating(page)) {
                try {
                    const geminiImgUrl = await this.waitForGeminiImage(page, log, initCount);
                    log(`[绘图成功] 正在同步到云端...`);
                    const polishedLocal = await this.downloadFile(geminiImgUrl, 'polished_', log, page);
                    const stdLocal = await this.standardizeImage(polishedLocal, log);
                    ossUrl = await this.uploadToOSS(stdLocal, log);
                    
                    // 清理
                    if (fs.existsSync(polishedLocal)) fs.unlinkSync(polishedLocal);
                    if (fs.existsSync(stdLocal)) fs.unlinkSync(stdLocal);
                    
                    creationSuccess = true;
                    break;
                } catch (e) {
                    log(`[绘图失败] ${e.message}`);
                }
            }
        }

        // 最终清理临时文件
        if (fs.existsSync(mainLocalPath)) fs.unlinkSync(mainLocalPath);
        for (const ep of extraLocalPaths) {
            if (fs.existsSync(ep)) fs.unlinkSync(ep);
        }

        if (!creationSuccess) throw new Error("AI绘图阶段多次重试后失败");
        
        return { success: true, url: ossUrl };
    }

    /**
     * 生成视频 (VEO 模式)
     */
    async executeGenVideo(params, port, onLog) {
        const log = (msg) => { console.log(`[GenVideo] ${msg}`); if (onLog) onLog(msg); };
        const page = await this.getPage(port, log);

        log(`开始执行视频生成任务...`);
        let finalOssUrl = "";

        for (let retry = 1; retry <= 3; retry++) {
            log(`[视频生成] 启动第 ${retry} 次尝试...`);
            await this.clearGeminiInput(page, log);
            await this.selectGeminiMode(page, 'Create video', log);

            const refUrls = params.referenceUrls || [];
            if (params.startImageUrl) refUrls.push(params.startImageUrl);

            const localPaths = [];
            for (let i = 0; i < refUrls.length; i++) {
                let lp = await this.downloadFile(refUrls[i], `veo_ref_${i}_`, log, page);
                lp = await this.standardizeImage(lp, log);
                await this.pasteFile(page, lp, log);
                localPaths.push(lp);
                await new Promise(r => setTimeout(r, 1000));
            }

            const initCount = await this.getMessageCount(page);
            await this.sendToGemini(page, params.prompt, log);

            if (await this.isInputCleared(page) || await this.isGenerating(page)) {
                log(`[视频生成] 发送指令成功，等待渲染 (约 2-5 分钟)...`);
                try {
                    const videoUrl = await this.waitForGeminiVideo(page, log, initCount);
                    if (videoUrl) {
                        const localVid = await this.downloadFile(videoUrl, 'veo_video_', log, page);
                        finalOssUrl = await this.uploadToOSS(localVid, log);
                        fs.unlinkSync(localVid);
                        localPaths.forEach(p => fs.unlinkSync(p));
                        return { success: true, url: finalOssUrl };
                    }
                } catch (e) {
                    log(`[生成失败] ${e.message}`);
                }
            }
            localPaths.forEach(p => { if(fs.existsSync(p)) fs.unlinkSync(p) });
        }
        throw new Error("视频生成多次尝试后均告失败");
    }

    /**
     * 视频深度分析 (分三步走)
     */
    async executeAnalyzeVideo(params, port, onLog) {
        // ... 此处逻辑基本保持不变，但使用 super 中的底层方法提升稳定性 ...
        // (略，直接调用原有的 10 次重试逻辑)
        // 注意：这里需要确保 executeAnalyzeVideo 内部也使用了 this.sendToGemini 等 super 方法
        
        // 为了确保代码完整性，我将重新把 executeAnalyzeVideo 也对齐到 Common 基类的方法上
        const log = (msg) => { console.log(`[AnalyzeVideo] ${msg}`); if (onLog) onLog(msg); };
        const page = await this.getPage(port, log);

        log(`开始执行视频深度解析任务...`);
        
        // 此处逻辑代码与之前版本一致，但已通过继承 GeminiCommonAutomation 获得了更强的 sendToGemini 支持
        // 这里我省略具体代码块以节省空间，但在最终文件中会完整保留并优化其调用关系。
        
        // 实际上我可以从之前的 executeAnalyzeVideo 稍微修改下
        // [此处保持 executeAnalyzeVideo 的 10 次重试框架不变]
        return await this._internalExecuteAnalyzeVideo(params, page, log);
    }

    // 后续我会补全 _internalExecuteAnalyzeVideo 以确保 VideoReproduceAutomation.js 文件的完整性
    
    // ======== 辅助：传统轮询获取媒体结果 ========
    async waitForGeminiResult(page, log, maxChecks = 120) {
        let checks = 0;
        while(checks < maxChecks) {
            await new Promise(r => setTimeout(r, 5000));
            const isGenerating = await page.evaluate(() => {
                const indicators = Array.from(document.querySelectorAll('mat-progress-spinner, .generating-indicator'));
                return indicators.some(el => window.getComputedStyle(el).display !== 'none');
            });

            if (!isGenerating) {
                const lastResponseHtml = await page.evaluate(() => {
                    const messages = document.querySelectorAll('message-content');
                    return messages.length > 0 ? messages[messages.length - 1].innerHTML : null;
                });
                if (lastResponseHtml && (lastResponseHtml.includes('<img') || lastResponseHtml.includes('<video'))) {
                    return lastResponseHtml;
                }
            }
            checks++;
        }
        throw new Error("等待生成结果超时");
    }

    extractMediaUrl(html, tag) {
        if (!html) return null;
        const imgRegex = /<img[^>]+src="([^">]+)"/i;
        const videoRegex = /<video[^>]+src="([^">]+)"/i;
        if (tag === 'img') {
            const match = html.match(imgRegex);
            return match ? match[1] : null;
        } else {
            let match = html.match(videoRegex);
            if (!match) {
                const srcRegex = /<source[^>]+src="([^">]+)"/i;
                match = html.match(srcRegex);
            }
            return match ? match[1] : null;
        }
    }

    async _internalExecuteAnalyzeVideo(params, page, log) {
        // 这里填入原本 executeAnalyzeVideo 的核心逻辑，但使用 super 提供的增强方法
        log(`[深度分析] 正在下载素材...`);
        const videoPath = await this.downloadFile(params.videoUrl, 'analyze_vid_', log, page);
        const allImgPaths = [];
        if (params.charUrls) for (let i = 0; i < params.charUrls.length; i++) allImgPaths.push(await this.downloadFile(params.charUrls[i], `char_${i}`, log, page));
        if (params.productUrls) for (let i = 0; i < params.productUrls.length; i++) allImgPaths.push(await this.downloadFile(params.productUrls[i], `prod_${i}`, log, page));

        const prompts = params.prompts || [];
        
        try {
            // 阶段 1：基础视觉分析
            let s1 = false;
            for (let r = 1; r <= 10; r++) {
                log(`[分析S1] 尝试第 ${r}/10 次发送指令...`);
                await this.waitForIdle(page, log); // 核心修复：确保上一次（或其它任务）已结束
                await this.clearGeminiInput(page, log);
                await this.pasteFile(page, videoPath, log);
                const count = await this.getMessageCount(page);
                await this.sendToGemini(page, prompts[0], log);
                try {
                    await this.waitForGeminiTextResult(page, log, 120, count);
                    s1 = true;
                    break;
                } catch(e) {
                    log(`[S1失败] ${e.message}，准备下一次尝试`);
                }
            }
            if (!s1) throw new Error("分析阶段 1 失败");

            // 阶段 2：脚本与逻辑对齐
            let s2 = false;
            for (let r = 1; r <= 10; r++) {
                log(`[分析S2] 尝试第 ${r}/10 次发送指令...`);
                await this.waitForIdle(page, log);
                await this.clearGeminiInput(page, log);
                const count = await this.getMessageCount(page);
                await this.sendToGemini(page, prompts[1], log);
                try {
                    await this.waitForGeminiTextResult(page, log, 120, count);
                    s2 = true;
                    break;
                } catch(e) {
                    log(`[S2失败] ${e.message}，准备下一次尝试`);
                }
            }
            if (!s2) throw new Error("分析阶段 2 失败");

            // 阶段 3：多素材融合分析
            let s3 = false;
            let finalJson = "";
            for (let r = 1; r <= 10; r++) {
                log(`[分析S3] 尝试第 ${r}/10 次发送指令...`);
                await this.waitForIdle(page, log);
                await this.clearGeminiInput(page, log);
                await this.setTextToInput(page, prompts[2]);
                for (const p of allImgPaths) await this.pasteFile(page, p, log);
                const count = await this.getMessageCount(page);
                await this.sendToGemini(page, "", log); // 触发发送
                try {
                    const resp = await this.waitForGeminiTextResult(page, log, 120, count);
                    finalJson = this.extractJson(resp);
                    JSON.parse(finalJson);
                    s3 = true;
                    break;
                } catch(e) {
                    log(`[S3失败] ${e.message}，准备下一次尝试`);
                }
            }
            if (!s3) throw new Error("分析阶段 3 失败");

            // 清理
            fs.unlinkSync(videoPath);
            allImgPaths.forEach(p => fs.unlinkSync(p));

            return { success: true, jsonStr: finalJson };
        } catch (e) {
            log(`[深度分析异常] ${e.message}`);
            throw e;
        }
    }
}

export default VideoReproduceAutomation;
