import axios from 'axios';
import logger from '../../../logger/logger.js';
import VideoReproduceAutomation from './VideoReproduceAutomation.js';

class VideoReproduceTaskPoller {
    constructor() {
        // this.BASE_URL = 'http://admin.ruoyivueplus.wulynk.com:8700/prod-api/business/localTask';
        this.BASE_URL = 'http://localhost:8080/business/localTask';
        this.isPolling = false;
        this.pollInterval = null;
        this.automation = new VideoReproduceAutomation();
        this.onStepLog = null;
        this.browserPort = 9223; // 默认Chrome调试端口
    }

    log(msg, type = 'info') {
        logger.info(`[VideoReproducePoller] ${msg}`);
        if (this.onStepLog) {
            this.onStepLog(msg, type);
        }
    }

    start(port) {
        if (this.isPolling) return;
        this.browserPort = port || 9223;
        this.isPolling = true;
        this.log('启动自动化任务轮询器...', 'success');
        this.poll();
        this.pollInterval = setInterval(() => this.poll(), 1000); // 更改为每秒轮询一次
    }

    stop() {
        if (!this.isPolling) return;
        this.isPolling = false;
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.log('已停止自动化任务轮询器.', 'warning');
    }

    getStatus() {
        return {
            isPolling: this.isPolling,
            browserPort: this.browserPort
        };
    }

    async getPendingCount() {
        try {
            const res = await axios.get(`${this.BASE_URL}/count`, {
                timeout: 10000,
                headers: { 'Connection': 'close' }
            });
            if (res.data && res.data.code === 200) {
                return res.data.data;
            }
        } catch (e) {
            // 静默处理 count 失败，避免日志刷屏
        }
        return 0;
    }

    async poll() {
        if (!this.isPolling) return;
        try {
            // this.log('正在检查是否有新任务...', 'info'); // 可选：如果觉得太吵可以注释掉，但用户要求详细
            const res = await axios.get(`${this.BASE_URL}/poll`, {
                timeout: 5000,
                headers: { 
                    'Connection': 'close'
                }
            });

            if (res.data && res.data.code === 200) {
                if (res.data.data) {
                    const task = res.data.data;
                    this.log(`发现新任务: [${task.taskType}] ID: ${task.id}`, 'info');
                    await this.executeTask(task);
                } else {
                    // 用户要求查的时候是否查出数据也要显示
                    // 为了不刷屏太快，我们只在低频打印这个（或者干脆按用户要求全打）
                    // this.log('暂无待分配任务', 'info');
                }
            } else {
                this.log(`轮询请求返回异常: ${res.data ? res.data.msg : '未知错误'}`, 'warning');
            }
        } catch (e) {
            this.log(`轮询接口通讯失败: ${e.message}`, 'error');
        }
    }

    async executeTask(task) {
        try {
            const params = JSON.parse(task.execParams || '{}');
            let resultData = null;

            if (task.taskType === 'WASH_IMAGE') {
                this.log(`开始执行洗图自动化 (TaskID: ${task.id})`, 'info');
                const result = await this.automation.executeWashImage(params, this.browserPort, (msg) => this.log(msg));
                if (result.success) {
                    resultData = JSON.stringify({ url: result.url });
                } else {
                    throw new Error("洗图自动化失败返回");
                }
            } else if (task.taskType === 'GEN_VIDEO') {
                this.log(`开始执行生成视频自动化 (TaskID: ${task.id})`, 'info');
                const result = await this.automation.executeGenVideo(params, this.browserPort, (msg) => this.log(msg));
                if (result.success) {
                    resultData = JSON.stringify({ url: result.url });
                } else {
                    throw new Error("生视频自动化失败返回");
                }
            } else if (task.taskType === 'ANALYZE_VIDEO') {
                this.log(`开始执行视频分析自动化 (TaskID: ${task.id})`, 'info');
                const result = await this.automation.executeAnalyzeVideo(params, this.browserPort, (msg) => this.log(msg));
                if (result.success) {
                    resultData = result.jsonStr;
                } else {
                    throw new Error("视频分析自动化失败返回");
                }
            } else {
                this.log(`未知的任务类型: ${task.taskType}`, 'warning');
                throw new Error("Unknown task type");
            }

            // 回调成功
            await this.callback(task.id, true, resultData, null);
        } catch (error) {
            this.log(`任务 ${task.id} 执行异常: ${error.message}`, 'error');
            await this.callback(task.id, false, null, error.message);
        }
    }

    async callback(taskId, success, resultData, errorMsg) {
        try {
            await axios.post(`${this.BASE_URL}/callback`, {
                taskId: taskId,
                success: success,
                resultData: resultData,
                errorMsg: errorMsg
            }, {
                timeout: 30000,
                headers: { 
                    'Content-Type': 'application/json',
                    'Connection': 'close'
                }
            });
            this.log(`任务 ${taskId} 回调成功 (状态: ${success ? '成功' : '失败'})`, 'success');
        } catch (e) {
            this.log(`上报任务 ${taskId} 结果失败: ${e.message}`, 'error');
        }
    }
}

export default new VideoReproduceTaskPoller();
