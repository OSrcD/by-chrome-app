import fs from 'fs';
import path from 'path';
import axios from 'axios';
import logger from '../../../logger/logger.js';
import GeminiCommonAutomation from '../GeminiCommonAutomation.js';

/**
 * 爬虫/素材复刻自动化服务
 * 继承自 GeminiCommonAutomation 基类，复用所有稳定性加固逻辑
 */
class ScraperAutomation extends GeminiCommonAutomation {
    constructor() {
        super();
        this.BACKEND_URL = 'http://admin.ruoyivueplus.wulynk.com:8700/prod-api';
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
        const rewriteText = await this.waitForGeminiTextResult(page, log, 120, initialCount);
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
     * B. 独立图片复刻
     */
    async executeRestyleImage(post, versionIndex, imageIndex, templates, port, onLog, options = {}) {
        const log = (msg) => { logger.info(`[RestyleImage] ${msg}`); if (onLog) onLog(msg); };
        const page = await this.getPage(port, log);

        log(`--- 启动图片复刻任务: 第 ${imageIndex + 1} 张 (重新建立对话) ---`);
        await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2000));

        const versions = JSON.parse(post.restyleInfo || '[]');
        if (!versions[versionIndex]) throw new Error('版本数据不匹配，请刷新页面');

        let imgUrl = options.sourceUrl;
        if (!imgUrl) {
            const originalImages = JSON.parse(post.images || '[]');
            const item = originalImages[imageIndex];
            imgUrl = item.urlDefault || item.url || (typeof item === 'string' ? item : '');
        }

        if (!imgUrl) throw new Error('参考源图片 URL 为空');

        const isPure = options.sourceMode?.endsWith('_pure');
        log(`[素材下载] 正在同步参考源...`);
        let localPath = await this.downloadFile(imgUrl, 'one_img', log, page);
        localPath = await this.standardizeImage(localPath, log);

        let finalPrompt = '';
        if (!isPure) {
            log(`[AI分析] 正在上传参考图提取特征...`);
            await this.clearGeminiInput(page, log);
            await this.pasteFile(page, localPath, log);
            const count1 = await this.sendToGemini(page, templates.analyze, log);
            await this.waitForGeminiTextResult(page, log, 60, count1);

            log(`[AI规划] 正在构造复刻方案...`);
            const count2 = await this.sendToGemini(page, templates.restyle, log);
            const restyleResp = await this.waitForGeminiTextResult(page, log, 60, count2);
            finalPrompt = JSON.parse(this.extractJson(restyleResp)).final_prompt;
        }

        log(`[AI绘图] 启动绘图引擎并载入素材...`);
        await this.clearGeminiInput(page, log);
        await this.selectGeminiMode(page, 'Create image', log);

        log(`[素材投放] 正在载入主参考图...`);
        await this.pasteFile(page, localPath, log);

        if (options.extraMaterials && options.extraMaterials.length > 0) {
            log(`[素材投放] 正在追加载入素材库参考图 (${options.extraMaterials.length}张)...`);
            for (const matUrl of options.extraMaterials) {
                let localMat = await this.downloadFile(matUrl, 'mat_ref', log, page);
                localMat = await this.standardizeImage(localMat, log);
                await this.pasteFile(page, localMat, log);
            }
        }

        const userPromptSnippet = options.customPrompt ? `\n\n${options.customPrompt}` : "";
        let enhancedPrompt = isPure ? 
            `请根据我上传的多个参考图，严格按照以下要求生成图片（直接绘图）：\n\n${options.customPrompt}` :
            `请根据上传的参考图和下面的提示词生成图片：\n\n${finalPrompt}${userPromptSnippet}`;

        const count3 = await this.sendToGemini(page, enhancedPrompt, log);
        const restyledImgUrl = await this.waitForGeminiImage(page, log, count3);

        log(`[资源入库] 正在同步复刻结果到云端...`);
        let localRestyled = await this.downloadFile(restyledImgUrl, 'restyled_one', log, page);
        localRestyled = await this.standardizeImage(localRestyled, log);
        const ossUrl = await this.uploadToOSS(localRestyled, log);

        if (!versions[versionIndex].images) versions[versionIndex].images = [];
        const existingImg = versions[versionIndex].images.find(i => i.originalIndex === imageIndex);
        if (existingImg) {
            if (existingImg.url && existingImg.url !== ossUrl) existingImg.prevUrl = existingImg.url;
            existingImg.url = ossUrl;
        } else {
            versions[versionIndex].images.push({ originalIndex: imageIndex, url: ossUrl });
        }

        await this.persistToBackend(post.scraperId, versions, post);
        log(`[任务完成] 第 ${imageIndex + 1} 张图片复刻入库。`);
        return { success: true, versions };
    }

    /**
     * C. 独立视频复刻
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

        log(`[素材准备] 正在载入已复刻的参考效果图...`);
        const targetImages = (ver.images || []).filter(img => !!img.url).slice(0, 3);
        for (const imgObj of targetImages) {
            let localImg = await this.downloadFile(imgObj.url, 'v_batch', log, page);
            localImg = await this.standardizeImage(localImg, log);
            await this.pasteFile(page, localImg, log);
        }

        if (options.extraMaterials && options.extraMaterials.length > 0) {
            log(`[强化参考] 正在载入额外参考图 (${options.extraMaterials.length} 张)...`);
            for (const matUrl of options.extraMaterials) {
                let localMat = await this.downloadFile(matUrl, 'mat_v_ref', log, page);
                localMat = await this.standardizeImage(localMat, log);
                await this.pasteFile(page, localMat, log);
            }
        }

        log(`[AI制作] 正在执行视频合成指令...`);
        await this.clearGeminiInput(page, log);
        await this.selectGeminiMode(page, 'Create video', log);

        const userPromptSnippet = options.customPrompt ? `\n\n${options.customPrompt}` : "";
        const videoPrompt = templates.video
            .replace('{{title}}', ver.title)
            .replace('{{content}}', ver.content) + userPromptSnippet;

        const countV = await this.sendToGemini(page, videoPrompt, log);
        const videoResourceUrl = await this.waitForGeminiVideo(page, log, countV);
        const localVideo = await this.downloadFile(videoResourceUrl, 'video_one', log, page);
        const videoOssUrl = await this.uploadToOSS(localVideo, log);

        if (ver.videoUrl && ver.videoUrl !== videoOssUrl) ver.prevVideoUrl = ver.videoUrl;
        ver.videoUrl = videoOssUrl;
        ver.status = 'Success';
        await this.persistToBackend(post.scraperId, versions, post);

        log(`[任务完成] 视频合成成功。`);
        return { success: true, versions };
    }

    /**
     * D. 撤回操作
     */
    async executeUndoRestyle(post, versionIndex, type, imageIndex = 0) {
        const versions = JSON.parse(post.restyleInfo || '[]');
        const ver = versions[versionIndex];
        if (!ver) throw new Error('版本不存在');

        if (type === 'image') {
            const img = ver.images.find(i => i.originalIndex === imageIndex);
            if (!img || !img.prevUrl) throw new Error('没有可撤回的历史记录');
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

    /**
     * E. 持久化
     */
    async persistToBackend(scraperId, versions, postObj = null) {
        const jsonStr = JSON.stringify(versions);
        try {
            await axios.put(`${this.BACKEND_URL}/business/scraper/updateRestyle`, {
                scraperId: scraperId,
                restyleInfo: jsonStr
            });
            if (postObj) postObj.restyleInfo = jsonStr; 
        } catch (e) {
            logger.error('[DB] 持久化失败: ' + e.message);
        }
    }
}

export default new ScraperAutomation();
