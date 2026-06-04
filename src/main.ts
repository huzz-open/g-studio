import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { preloadCV } from './modules/sprite-slicer/core/opencv/loader'
import './style.css'

preloadCV()

const app = createApp(App)
app.use(router)
app.mount('#app')
