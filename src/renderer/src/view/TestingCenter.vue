<template>
  <el-container class="testing-center-container">
    <el-header height="auto" class="center-header">
      <div class="header-card">
        <h2 class="title">测试中心 <span class="subtitle">Testing Hub</span></h2>
        <p class="desc">集中管理全平台采集、账号风控及业务逻辑的自动化单元测试。</p>
      </div>
    </el-header>

    <el-main class="center-main">
      <el-tabs v-model="activeTab" class="custom-tabs" type="border-card">
        <!-- 标签页 1：采集性能测试 (原 ScraperTester 逻辑) -->
        <el-tab-pane name="scraper">
          <template #label>
            <span class="tab-label">
              <el-icon><Cpu /></el-icon> 采集解析测试
            </span>
          </template>
          
          <div class="tab-content">
            <el-form :inline="true" class="test-form">
              <el-form-item label="测试 URL">
                <el-input v-model="scraperForm.url" placeholder="输入帖子或搜索页 URL" style="width: 400px" clearable />
              </el-form-item>
              <el-form-item label="环境">
                <el-select v-model="scraperForm.port" placeholder="选择环境" style="width: 140px">
                  <el-option v-for="win in openWindows" :key="win.chromePort" :label="win.name" :value="win.chromePort" />
                </el-select>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="loading" @click="runScraperTest">启动测试</el-button>
                <el-button :icon="Refresh" circle @click="refreshWindows" />
              </el-form-item>
            </el-form>

            <el-row :gutter="20" class="results-row">
              <el-col :span="16">
                <div class="result-viewer">
                  <div v-if="scraperResults.length > 0" class="results-list">
                    <div v-for="(item, index) in scraperResults" :key="index" class="result-item">
                      <div class="item-header">
                        <el-tag size="small" type="success" effect="plain">{{ item.platform === '0' ? '小红书' : '未知' }}</el-tag>
                        <span class="item-title">{{ item.title || '（未解析到标题）' }}</span>
                      </div>
                      <div class="item-author">作者: {{ item.author }} | 帖子ID: {{ item.postId }}</div>
                      <div class="item-content">{{ item.content }}</div>
                      <div class="item-media" v-if="getImages(item).length > 0">
                        <div class="media-grid">
                          <el-image v-for="(img, idx) in getImages(item).slice(0, 5)" :key="idx" :src="img" :preview-src-list="getImages(item)" class="thumb" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <el-empty v-else description="请输入 URL 并选择活跃环境进行采集测试" />
                </div>
              </el-col>
              <el-col :span="8">
                <div class="log-viewer">
                  <div class="log-header">
                    <span>运行日志</span>
                    <el-button type="text" size="small" @click="scraperLogs = ''">清空</el-button>
                  </div>
                  <pre class="json-content">{{ scraperLogs || '等待任务开始...' }}</pre>
                </div>
              </el-col>
            </el-row>
          </div>
        </el-tab-pane>

        <!-- 标签页 2：账号风控测试 (预留) -->
        <el-tab-pane name="account" disabled>
          <template #label>
            <span class="tab-label">
              <el-icon><User /></el-icon> 账号风控验证
            </span>
          </template>
        </el-tab-pane>

        <!-- 标签页 3：接口连通性测试 (预留) -->
        <el-tab-pane name="api">
          <template #label>
            <span class="tab-label">
              <el-icon><Link /></el-icon> 接口与白名单测试
            </span>
          </template>
          <div class="empty-placeholder">
            <el-result icon="info" title="接口测试开发中" sub-title="此功能将用于验证 RuoYi 后端与白名单网关的连通性。">
            </el-result>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-main>
  </el-container>
</template>

<script setup>
import { ref, onMounted, reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh, Cpu, User, Link } from '@element-plus/icons-vue';

const activeTab = ref('scraper');
const openWindows = ref([]);
const loading = ref(false);

// 采集测试相关
const scraperForm = reactive({
  url: '',
  port: null
});
const scraperResults = ref([]);
const scraperLogs = ref('');

const refreshWindows = async () => {
  try {
    const list = await window.electronAPI.invoke('get-open-windows');
    openWindows.value = list;
    if (list.length > 0 && !scraperForm.port) {
      scraperForm.port = list[0].chromePort;
    }
  } catch (e) {
    ElMessage.error("环境加载失败");
  }
};

const runScraperTest = async () => {
  if (!scraperForm.url) return ElMessage.warning("请输入待测 URL");
  if (!scraperForm.port) return ElMessage.warning("请选择活跃的浏览器环境");

  loading.value = true;
  scraperLogs.value = `[${new Date().toLocaleTimeString()}] 任务分发成功...\nURL: ${scraperForm.url}\nPort: ${scraperForm.port}\n---`;
  scraperResults.value = [];

  try {
    const res = await fetch(`http://localhost:3000/window/scrapeByUrl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: scraperForm.port, url: scraperForm.url })
    });
    
    const result = await res.json();
    scraperLogs.value += `\n\n[后端响应]:\n${JSON.stringify(result, null, 2)}`;

    if (result.code === 200) {
      ElMessage.success("采集逻辑执行成功");
      scraperResults.value = Array.isArray(result.data) ? result.data : [result.data];
    } else {
      ElMessage.error(result.msg || "解析失败");
    }
  } catch (e) {
    scraperLogs.value += `\n\n[致命错误]: ${e.message}`;
    ElMessage.error(`请求异常: ${e.message}`);
  } finally {
    loading.value = false;
  }
};

const getImages = (item) => {
  try { return JSON.parse(item.images || '[]'); } catch (e) { return []; }
};

onMounted(refreshWindows);
</script>

<style scoped>
.testing-center-container {
  padding: 15px;
  height: 100vh;
  box-sizing: border-box;
}

.header-card {
  background: linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(240,245,255,0.9) 100%);
  padding: 20px 25px;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.05);
  margin-bottom: 15px;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.5);
}

.title { margin: 0; font-size: 22px; color: #1f2d3d; display: flex; align-items: baseline; gap: 10px; }
.subtitle { font-size: 14px; color: #909399; font-weight: normal; }
.desc { margin-top: 8px; font-size: 14px; color: #606266; }

.custom-tabs {
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 15px rgba(0,0,0,0.05);
  height: calc(100vh - 160px);
}

.tab-label { display: flex; align-items: center; gap: 6px; }

.tab-content { padding: 10px; height: 100%; display: flex; flex-direction: column; }

.results-row { flex: 1; margin-top: 15px; overflow: hidden; }

.result-viewer {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  height: calc(100vh - 300px);
  overflow-y: auto;
  padding: 15px;
}

.result-item {
  border: 1px solid #f2f6fc;
  padding: 15px;
  border-radius: 10px;
  background: #fafafa;
  margin-bottom: 20px;
}

.item-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.item-title { font-weight: 600; font-size: 16px; color: #2c3e50; }
.item-author { font-size: 12px; color: #95a5a6; margin-bottom: 10px; }
.item-content { 
  font-size: 14px; color: #34495e; line-height: 1.6; 
  background: white; padding: 10px; border-radius: 6px;
}

.item-media { margin-top: 12px; }
.media-grid { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 5px; }
.thumb { width: 90px; height: 90px; border-radius: 6px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }

.log-viewer {
  background: #1e1e1e;
  border-radius: 8px;
  height: calc(100vh - 300px);
  display: flex;
  flex-direction: column;
}

.log-header {
  padding: 8px 15px;
  border-bottom: 1px solid #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #888;
  font-size: 12px;
}

.json-content {
  margin: 0;
  padding: 15px;
  color: #72b145;
  font-family: 'Fira Code', monospace;
  font-size: 12px;
  overflow: auto;
  flex: 1;
}

.empty-placeholder {
  display: flex; 
  justify-content: center; 
  align-items: center; 
  height: 300px;
}
</style>
