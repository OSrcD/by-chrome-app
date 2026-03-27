<template>
  <div class="env-selector-wrapper">
    <div class="section-header">
      <h3>活跃浏览器环境列表 ({{ data.length }} 个)</h3>
      <el-button @click="$emit('refresh')" type="primary" link :icon="Refresh">刷新连接</el-button>
    </div>
    
    <el-table 
      v-loading="loading" 
      :data="data" 
      class="custom-table" 
      border 
      stripe
    >
      <el-table-column prop="name" label="环境名称">
        <template #default="scope">
          <div class="env-name">
            <el-icon><Monitor /></el-icon>
            <span>{{ scope.row.name }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="chromePort" label="调试端口" width="100" align="center" />
      <el-table-column label="任务状态" width="120" align="center">
        <template #default="scope">
          <el-tag 
            v-if="statusPool[scope.row.chromePort]"
            :type="getTagType(statusPool[scope.row.chromePort])" 
            effect="dark"
          >
            {{ getStatusText(statusPool[scope.row.chromePort]) }}
          </el-tag>
          <el-tag v-else type="info">未分配</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="任务操作" width="280">
        <template #default="scope">
          <el-button-group>
            <el-button 
              type="primary" 
              size="small" 
              plain
              :loading="activePort === scope.row.chromePort" 
              @click="$emit('start', scope.row.chromePort)"
              :disabled="disabled || (statusPool[scope.row.chromePort] === 'running')"
            >
              启动任务
            </el-button>
            <el-button 
              v-if="statusPool[scope.row.chromePort]"
              type="success" 
              size="small" 
              icon="Monitor"
              @click="$emit('open-log', scope.row.chromePort)"
            >
              日志
            </el-button>
          </el-button-group>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="data.length === 0 && !loading" class="empty-holder">
      <el-empty description="未检测到启动环境，请前往环境管理启动浏览器" :image-size="80" />
    </div>
  </div>
</template>

<script setup>
import { Refresh, Monitor } from '@element-plus/icons-vue';

const props = defineProps({
  data: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  activePort: { type: [String, Number], default: null },
  statusPool: { type: Object, default: () => ({}) },
  disabled: { type: Boolean, default: false }
});

const emit = defineEmits(['refresh', 'start', 'open-log']);

const getTagType = (status) => {
  const map = {
    running: 'warning',
    paused: 'primary',
    stopped: 'danger'
  };
  return map[status] || 'info';
};

const getStatusText = (status) => {
  const map = {
    running: '执行中',
    paused: '已暂停',
    stopped: '已结束'
  };
  return map[status] || status;
};
</script>

<style scoped>
.env-selector-wrapper {
  padding: 10px 0;
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.section-header h3 {
  margin: 0;
  font-size: 15px;
  color: #303133;
}
.env-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}
.empty-holder {
  padding: 40px 0;
  display: flex;
  justify-content: center;
}
:deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
}
</style>
