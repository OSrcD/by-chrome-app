<template>
  <el-drawer
    v-model="visible"
    direction="rtl"
    size="42%"
  >
    <template #header>
      <div class="drawer-header">
        <span class="title">任务执行实时监控</span>
        <div class="controls" v-if="port">
          <el-button-group>
            <el-button 
              v-if="status === 'running'" 
              type="warning" 
              size="small" 
              icon="VideoPause"
              @click="$emit('control', 'paused')"
            >暂停</el-button>
            <el-button 
              v-if="status === 'paused'" 
              type="primary" 
              size="small" 
              icon="VideoPlay"
              @click="$emit('control', 'running')"
            >继续</el-button>
            <el-button 
              type="danger" 
              size="small" 
              icon="CircleClose"
              @click="$emit('control', 'stopped')"
            >终止</el-button>
          </el-button-group>
        </div>
      </div>
    </template>
    
    <div class="log-container">
      <div v-for="(log, index) in logs" :key="index" :class="['log-item', log.type]">
        <span class="log-time">[{{ log.time }}]</span>
        <span class="log-msg">{{ log.msg }}</span>
      </div>
      <div v-if="logs.length === 0" class="empty-log">
        <el-text type="info" size="small">尚未开始任何任务实时流监控...</el-text>
      </div>
    </div>
  </el-drawer>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  logs: { type: Array, default: () => [] },
  status: { type: String, default: 'running' }, // running, paused, stopped
  port: { type: [Number, String], default: null }
});

const emit = defineEmits(['update:modelValue', 'control']);

// 使用响应式 Proxy 避免直接读写 Prop
const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});
</script>

<style scoped>
.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}
.drawer-header .title {
  font-weight: bold;
  font-size: 16px;
  color: #333;
}
.log-container {
  background: #121212;
  height: 100%;
  padding: 15px;
  font-family: 'Fira Code', monospace;
  overflow-y: auto;
  border-radius: 4px;
  scrollbar-width: thin;
  scrollbar-color: #333 #121212;
}

.log-item {
  margin-bottom: 6px;
  font-size: 13px;
  line-height: 1.6;
  border-bottom: 1px solid #1f1f1f;
  padding-bottom: 2px;
}

.log-time {
  color: #707070;
  margin-right: 12px;
}

.log-msg {
  color: #e0e0e0;
}

.log-item.success .log-msg { color: #a5d6a7; }
.log-item.error .log-msg { color: #ef9a9a; }
.log-item.primary .log-msg { color: #90caf9; font-weight: 500; }
.log-item.info .log-msg { color: #808080; }

.empty-log {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
