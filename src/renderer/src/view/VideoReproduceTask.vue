<template>
  <div class="video-queue-container">
    <div class="header">
      <div class="title">
        <el-icon class="icon-main"><VideoCamera /></el-icon>
        <h2>视频复刻本地自动化执行中心</h2>
      </div>
      <div class="status-tags">
        <el-tag :type="status.isPolling ? 'success' : 'info'" effect="dark">
          {{ status.isPolling ? '云端监听中' : '服务待命' }}
        </el-tag>
        <el-tag type="warning" effect="plain" v-if="status.isPolling">
          调试端口: {{ status.browserPort }}
        </el-tag>
      </div>
    </div>

    <el-row :gutter="20">
      <!-- 左侧：控制面板与统计 -->
      <el-col :span="8">
        <el-card class="control-card shadow-card" header="设置与控制">
          <el-form label-position="top">
            <el-form-item label="1. 选择执行环境 (Chrome 调试端口)">
              <div v-loading="loadingList" class="env-selection-list">
                <div v-for="win in openWindows" :key="win.chromePort"
                     class="env-item" :class="{ active: config.port === win.chromePort }"
                     @click="config.port = win.chromePort">
                  <el-icon class="env-icon"><Monitor /></el-icon>
                  <div class="env-info">
                    <div class="env-name">{{ win.name || '未命名环境' }}</div>
                    <div class="env-port">端口: {{ win.chromePort }}</div>
                  </div>
                  <el-radio v-model="config.port" :label="win.chromePort">{{''}}</el-radio>
                </div>
                <div v-if="!loadingList && openWindows.length === 0" class="no-env">
                  <el-empty :image-size="40" description="未发现活跃环境" />
                  <el-button type="primary" link @click="refreshOpenList">尝试刷新</el-button>
                </div>
              </div>
              <div class="header-actions" style="margin-top: 10px;">
                <el-button size="small" icon="Refresh" @click="refreshOpenList" :loading="loadingList">刷新环境列表</el-button>
              </div>
            </el-form-item>
            
            <div class="action-buttons">
              <el-button 
                type="primary" 
                size="large" 
                :disabled="status.isPolling" 
                @click="handleStart"
                class="btn-action"
              >
                <el-icon><VideoPlay /></el-icon> 启动轮询监听
              </el-button>
              <el-button 
                type="danger" 
                size="large" 
                :disabled="!status.isPolling" 
                @click="handleStop"
                class="btn-action"
              >
                <el-icon><VideoPause /></el-icon> 停止执行
              </el-button>
            </div>
          </el-form>
        </el-card>

        <el-card class="stats-card shadow-card" header="任务队列统计">
          <div class="stats-grid">
            <div class="stat-item">
              <div class="stat-value">{{ pendingCount }}</div>
              <div class="stat-label">待处理任务</div>
            </div>
            <div class="stat-item">
              <div class="stat-indicator" :class="{ 'pulse': status.isPolling }"></div>
              <div class="stat-label">{{ status.isPolling ? '正在监听' : '已停止' }}</div>
            </div>
          </div>
          <div class="refresh-info">
            数据每 10s 自动更新一次
          </div>
        </el-card>
      </el-col>

      <!-- 右侧：执行日志 -->
      <el-col :span="16">
        <el-card class="log-card shadow-card">
          <template #header>
            <div class="log-header">
              <span>实时执行轨迹</span>
              <el-button link type="primary" @click="clearLogs">
                <el-icon><Delete /></el-icon> 清空控制台
              </el-button>
            </div>
          </template>
          
          <div class="terminal" ref="terminalRef">
            <div v-if="logs.length === 0" class="empty-log">
              等待任务下发中...
            </div>
            <div v-for="(log, index) in logs" :key="index" :class="['log-line', log.type]">
              <span class="log-time">[{{ log.time }}]</span>
              <span class="log-msg">{{ log.msg }}</span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { VideoCamera, VideoPlay, VideoPause, Delete, Monitor, Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useScraperTask } from '../hooks/useScraperTask';

const { openWindows, loadingList, refreshOpenList } = useScraperTask();

const config = ref({
  port: 9223
});

const status = ref({
  isPolling: false,
  browserPort: 9223
});

const logs = ref([]);
const terminalRef = ref(null);
const pendingCount = ref(0);
let countInterval = null;

const fetchStatus = async () => {
  const currentStatus = await window.electronAPI.invoke('video-reproduce-status');
  status.value = currentStatus;
  if (currentStatus.browserPort) {
    config.value.port = currentStatus.browserPort;
  }
};

const fetchPendingCount = async () => {
  try {
    const count = await window.electronAPI.invoke('video-reproduce-count');
    pendingCount.value = count || 0;
  } catch (e) {
    console.warn('Failed to fetch count', e);
  }
};

const handleStart = async () => {
  try {
    await window.electronAPI.invoke('video-reproduce-start', { port: config.value.port });
    ElMessage.success('成功启动轮询器');
    fetchStatus();
  } catch (e) {
    ElMessage.error('启动失败: ' + e.message);
  }
};

const handleStop = async () => {
  try {
    await window.electronAPI.invoke('video-reproduce-stop');
    ElMessage.warning('轮询器已停止工作');
    fetchStatus();
  } catch (e) {
    ElMessage.error('停止失败: ' + e.message);
  }
};

const addLog = (data) => {
  const now = new Date().toLocaleTimeString();
  logs.value.push({
    time: now,
    msg: data.msg,
    type: data.type || 'info'
  });
  
  // 限制日志条数
  if (logs.value.length > 500) {
    logs.value.shift();
  }
  
  nextTick(() => {
    if (terminalRef.value) {
      terminalRef.value.scrollTop = terminalRef.value.scrollHeight;
    }
  });
};

const clearLogs = () => {
  logs.value = [];
};

onMounted(() => {
  fetchStatus();
  fetchPendingCount();
  refreshOpenList();
  
  // 每 10 秒刷新一次全局待处理任务数
  countInterval = setInterval(() => {
    fetchPendingCount();
  }, 10000);

  // 监听来自主进程的自动化轨迹日志
  window.electronAPI.on('video-reproduce-log', (data) => {
    addLog(data);
  });
});

onBeforeUnmount(() => {
  if (countInterval) clearInterval(countInterval);
});

</script>

<style scoped>
.video-queue-container {
  padding: 24px;
  color: #2c3e50;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  height: calc(100vh - 40px);
  overflow-y: auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon-main {
  font-size: 32px;
  color: #409eff;
}

.title h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  background: linear-gradient(120deg, #2c3e50, #409eff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.status-tags {
  display: flex;
  gap: 8px;
}

.shadow-card {
  border-radius: 12px;
  border: none;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05) !important;
  margin-bottom: 20px;
}

.control-card .tip {
  font-size: 12px;
  color: #909399;
  margin-top: 8px;
  line-height: 1.4;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 24px;
}

.btn-action {
  width: 100%;
  height: 50px;
  font-size: 16px;
  font-weight: bold;
}

.stats-grid {
  display: flex;
  justify-content: space-around;
  padding: 10px 0;
}

.stat-item {
  text-align: center;
  position: relative;
}

.stat-value {
  font-size: 36px;
  font-weight: 800;
  color: #409eff;
  line-height: 1;
}

.stat-label {
  font-size: 13px;
  color: #909399;
  margin-top: 8px;
}

.stat-indicator {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #909399;
  margin: 0 auto;
}

.stat-indicator.pulse {
  background: #67c23a;
  box-shadow: 0 0 0 0 rgba(103, 194, 58, 0.4);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(103, 194, 58, 0.7); }
  70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(103, 194, 58, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(103, 194, 58, 0); }
}

/* 环境选择样式 */
.env-selection-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid #f0f2f5;
  border-radius: 8px;
  background: #fafafa;
}

.env-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 8px;
  background: #fff;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}

.env-item:hover {
  background: #f1f5f9;
}

.env-item.active {
  background: #fffbeb;
  border-color: #f59e0b;
}

.env-icon {
  font-size: 20px;
  color: #f59e0b;
  background: #fff9eb;
  padding: 6px;
  border-radius: 6px;
}

.env-info {
  flex: 1;
}

.env-name {
  font-size: 13px;
  font-weight: 700;
  color: #334155;
}

.env-port {
  font-size: 11px;
  color: #64748b;
}

.no-env {
  padding: 20px;
  text-align: center;
}

.refresh-info {
  text-align: center;
  font-size: 11px;
  color: #c0c4cc;
  margin-top: 16px;
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.terminal {
  background: #1e1e1e;
  color: #d4d4d4;
  height: 60vh;
  padding: 15px;
  font-family: 'Fira Code', 'Courier New', Courier, monospace;
  font-size: 13px;
  line-height: 1.6;
  overflow-y: auto;
  border-radius: 8px;
  border: 1px solid #333;
}

.empty-log {
  color: #555;
  font-style: italic;
  text-align: center;
  margin-top: 40px;
}

.log-line {
  margin-bottom: 4px;
  word-break: break-all;
}

.log-time {
  color: #858585;
  margin-right: 8px;
}

.info .log-msg { color: #d4d4d4; }
.success .log-msg { color: #6a9955; font-weight: bold; }
.warning .log-msg { color: #d7ba7d; }
.error .log-msg { color: #f44747; font-weight: bold; }

/* 窗口微调适配 */
:deep(.el-card__header) {
  padding: 12px 20px;
  font-weight: bold;
  font-size: 15px;
  border-bottom: 1px solid #f0f2f5;
  background-color: #fafbfc;
}
</style>
