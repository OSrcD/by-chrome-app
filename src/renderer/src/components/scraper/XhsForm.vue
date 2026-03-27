<template>
  <div class="platform-form glass-card">
    <div class="form-header">
      <el-icon class="platform-icon"><WindPower /></el-icon>
      <h4>小红书搜索设置</h4>
    </div>
    
    <el-form :model="formData" label-position="top">
      <el-row :gutter="20">
        <el-col :span="12">
          <el-form-item label="检索内容 (可选多个，用逗号分隔)">
            <el-input 
              v-model="formData.keyword" 
              placeholder="例如: 自助棋牌, 无人棋牌, 小程序开发" 
              prefix-icon="Search"
              clearable 
            />
          </el-form-item>
        </el-col>
        <el-col :span="4">
          <el-form-item label="排序权重">
            <el-radio-group v-model="formData.filters.sort">
              <el-radio-button label="general">综合</el-radio-button>
              <el-radio-button label="newest">最新</el-radio-button>
            </el-radio-group>
          </el-form-item>
        </el-col>
        <el-col :span="4">
          <el-form-item label="解析内容">
            <el-select v-model="formData.filters.type">
              <el-option label="默认/图文" value="note" />
              <el-option label="视频内容" value="video" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="4">
          <el-form-item label="位置距离">
            <el-select v-model="formData.filters.region" placeholder="选择范围">
              <el-option label="不限/全国" value="all" />
              <el-option label="同城内容" value="local" />
              <el-option label="附近笔记" value="nearby" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="4">
          <el-form-item label="去重过滤">
            <el-switch
              v-model="formData.filters.unseen"
              active-text="未看过"
              inactive-text="不限"
            />
          </el-form-item>
        </el-col>
        <el-col :span="4">
          <el-form-item label="从第 [ ? ] 轮开始抓">
            <el-input-number 
              v-model="formData.filters.startRound" 
              :min="1" 
              :max="9999" 
              size="small"
              placeholder="起始次"
            />
          </el-form-item>
        </el-col>
        <el-col :span="4">
          <el-form-item label="本次连续抓 [ ? ] 轮">
            <el-input-number 
              v-model="formData.filters.maxRounds" 
              :min="1" 
              :max="100" 
              size="small"
              placeholder="总次数"
            />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>
  </div>
</template>

<script setup>
import { reactive, watch } from 'vue';
import { WindPower } from '@element-plus/icons-vue';

const props = defineProps({
  modelValue: { type: Object, required: true }
});

const emit = defineEmits(['update:modelValue']);

// 复用外部传入的响应式数据
const formData = props.modelValue;

// 监听变化同步
watch(formData, (newVal) => {
  emit('update:modelValue', newVal);
}, { deep: true });
</script>

<style scoped>
.glass-card {
  background: rgba(255, 255, 255, 0.4);
  padding: 20px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  margin-bottom: 25px;
}
.form-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 15px;
}
.form-header h4 {
  margin: 0;
  font-size: 15px;
  color: #333;
}
.platform-icon {
  color: #ff2442; /* 小红书红 */
}
:deep(.el-form-item__label) {
  font-weight: bold;
}
</style>
