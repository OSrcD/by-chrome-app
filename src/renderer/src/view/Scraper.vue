<template>
  <el-container class="scraper-hub-container">
    <el-header height="auto" class="scraper-header">
      <div class="hub-title glass-panel">
        <el-icon class="title-icon"><Monitor /></el-icon>
        <div class="text-group">
          <h2>素材自动化采集中心 (Scraper Hub)</h2>
          <p>多平台、多维度、高并发的业务素材采集与处理引擎。</p>
        </div>
      </div>
    </el-header>

    <el-main class="scraper-main">
      <div class="main-card glass-panel">
        <!-- 平台选择 Tab -->
        <el-tabs v-model="activePlatformTab" class="custom-tabs">
          <!-- 小红书平台 -->
          <el-tab-pane name="0">
            <template #label>
              <span class="tab-label">
                <el-icon><WindPower /></el-icon> 小红书 XHS
              </span>
            </template>
            <XhsForm v-model="xhsTaskParams" />
            <EnvTable 
              :data="openWindows" 
              :loading="loadingList" 
              :active-port="scrapeLoading"
              :status-pool="taskStatusPool"
              @refresh="refreshOpenList"
              @start="handleStartTask"
              @open-log="handleOpenLog"
            />
          </el-tab-pane>

          <!-- 抖音平台 -->
          <el-tab-pane name="1">
            <template #label>
              <span class="tab-label">
                <el-icon><VideoCamera /></el-icon> 抖音 Douyin
              </span>
            </template>
            <DouyinForm />
          </el-tab-pane>
        </el-tabs>

        <!-- 视频链接刷新调度器 -->
        <div class="refresh-scheduler">
          <div class="scheduler-left">
            <el-icon style="color: #e6a23c; font-size: 18px;"><Refresh /></el-icon>
            <span class="scheduler-title">媒体链接定时刷新</span>
            <el-tag :type="refreshRunning ? 'success' : 'info'" size="small" effect="dark">
              {{ refreshRunning ? '运行中' : '未启动' }}
            </el-tag>
          </div>
          <div class="scheduler-right">
            <span style="font-size: 13px; color: #888; margin-right: 8px;">间隔(秒):</span>
            <el-input-number 
              v-model="refreshInterval" 
              :min="5" :max="3600" size="small" 
              :disabled="refreshRunning"
              style="width: 100px; margin-right: 12px;" 
            />
            <el-button v-if="!refreshRunning" type="warning" size="small" @click="startRefreshScheduler">
              启动刷新
            </el-button>
            <el-button v-else type="danger" size="small" @click="stopRefreshScheduler">
              停止刷新
            </el-button>
            <el-button type="primary" size="small" plain @click="runRefreshOnce" :loading="refreshLoading">
              立即执行一次
            </el-button>
          </div>
        </div>
      </div>
    </el-main>

    <!-- 共有实时日志面板 (LogConsole) -->
    <LogConsole 
      v-model="showProgress" 
      :logs="taskLogsPool[activePortState] || []"
      :status="taskStatusPool[activePortState]"
      :port="activePortState"
      @control="(status) => controlScraperTask(activePortState, status)"
    />
  </el-container>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import { Monitor, WindPower, VideoCamera, Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import cache from '../utils/cache';

// 引入共享 Hook (逻辑复用)
import { useScraperTask } from '../hooks/useScraperTask';

// 引入通用原子组件 (DRY)
import EnvTable from '../components/scraper/EnvTable.vue';
import LogConsole from '../components/scraper/LogConsole.vue';

// 引入平台特性组件 (封装与隔离)
import XhsForm from '../components/scraper/XhsForm.vue';
import DouyinForm from '../components/scraper/DouyinForm.vue';

// 使用自定义 Hook
const {
  openWindows,
  loadingList,
  scrapeLoading,
  showProgress,
  taskLogsPool,
  taskStatusPool,
  refreshOpenList,
  executeScraperTask,
  controlScraperTask
} = useScraperTask();

const activePlatformTab = ref(cache.local.get('active_platform_tab') || '0'); 

// 监听 Tab 切换并保存
watch(activePlatformTab, (val) => {
  cache.local.set('active_platform_tab', val);
});

// 平台专属任务参数 (从本地缓存加载或默认)
const STORAGE_KEY_XHS = 'scraper_xhs_params';
const cachedParams = cache.local.getJSON(STORAGE_KEY_XHS);

const xhsTaskParams = reactive(cachedParams || {
  keyword: '',
  filters: {
    sort: 'general',
    type: 'note',
    region: 'all',
    unseen: false,
    maxRounds: 1,
    startRound: 1
  }
});

// 监听变化并同步到本地存储
watch(xhsTaskParams, (newVal) => {
  cache.local.setJSON(STORAGE_KEY_XHS, newVal);
}, { deep: true });

const activePortState = ref(null);

/**
 * 切换监控环境抽屉
 */
const handleOpenLog = (port) => {
  activePortState.value = port;
  showProgress.value = true;
};

/**
 * 启动任务中转：接收来自 EnvTable 的端口信号
 */
const handleStartTask = (port) => {
  activePortState.value = port;
  showProgress.value = true; // 启动时自动通过抽屉显示日志
  
  if (activePlatformTab.value === '0') {
    // 启动小红书任务 (采集完成后自动进位，方便下一轮抓下一批)
    executeScraperTask(port, '0', xhsTaskParams.keyword, xhsTaskParams.filters).then(() => {
        xhsTaskParams.filters.startRound += xhsTaskParams.filters.maxRounds;
    });
  } else if (activePlatformTab.value === '1') {
    // 启动抖音任务 (占位)
    import('element-plus').then(({ ElMessage }) => ElMessage.info("抖音自动化模块正在内测中..."));
  }
};

// ========== 媒体链接定时刷新调度器 (图片+视频) ==========
const refreshInterval = ref(10); // 默认 10 秒
const refreshRunning = ref(false);
const refreshLoading = ref(false);
let refreshTimer = null;

const runRefreshOnce = async () => {
  // 需要一个活跃的环境端口
  const port = activePortState.value || openWindows.value?.[0]?.port;
  if (!port) {
    ElMessage.warning('请先选择一个活跃的浏览器环境');
    return;
  }
  refreshLoading.value = true;
  try {
    const res = await fetch('http://localhost:3000/window/refreshVideos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port })
    });
    const result = await res.json();
    if (result.code === 200) {
      ElMessage.success(result.msg || '刷新完成');
    } else {
      ElMessage.error(result.msg || '刷新失败');
    }
  } catch (e) {
    ElMessage.error(`刷新异常: ${e.message}`);
  } finally {
    refreshLoading.value = false;
  }
};

const startRefreshScheduler = () => {
  if (refreshTimer) return;
  refreshRunning.value = true;
  // 立即执行一次
  runRefreshOnce();
  // 按间隔循环执行
  refreshTimer = setInterval(() => {
    runRefreshOnce();
  }, refreshInterval.value * 1000);
  ElMessage.success(`刷新调度已启动，每 ${refreshInterval.value} 秒执行一次`);
};

const stopRefreshScheduler = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  refreshRunning.value = false;
  ElMessage.info('刷新调度已停止');
};

onMounted(() => {
  refreshOpenList();
});

onUnmounted(() => {
  // 页面销毁时清理定时器
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
});
</script>

<style scoped>
.scraper-hub-container {
  height: 100vh;
  padding: 20px;
  background: transparent;
  overflow: hidden;
}

.glass-panel {
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow: 0 10px 40px 0 rgba(0, 0, 0, 0.05);
}

.hub-title {
  padding: 24px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 24px;
}

.title-icon {
  font-size: 32px;
  padding: 12px;
  background: #1a73e8;
  color: white;
  border-radius: 12px;
}

.text-group h2 {
  margin: 0;
  font-size: 20px;
  color: #1a1a1a;
}

.text-group p {
  margin: 4px 0 0;
  color: #666;
  font-size: 14px;
}

.scraper-main {
  padding: 0;
  height: calc(100% - 150px);
}

.main-card {
  height: 100%;
  padding: 20px;
  border-radius: 20px;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: bold;
}

:deep(.el-tabs__nav-wrap::after) {
  display: none;
}

:deep(.el-tabs__item) {
  font-size: 15px;
  height: 44px;
}

:deep(.el-tabs__active-bar) {
  height: 3px;
  border-radius: 3px;
}

.refresh-scheduler {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  margin-top: 16px;
  background: rgba(230, 162, 60, 0.06);
  border: 1px solid rgba(230, 162, 60, 0.2);
  border-radius: 10px;
}

.scheduler-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scheduler-title {
  font-weight: 600;
  font-size: 14px;
  color: #333;
}

.scheduler-right {
  display: flex;
  align-items: center;
}
</style>
