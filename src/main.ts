import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { preloadCV } from './modules/sprite-slicer/core/opencv/loader'
import './shared/module-registry/register-all'
import './style.css'

const app = createApp(App)
app.use(router)
app.mount('#app')

router.isReady().then(() => preloadCV())
