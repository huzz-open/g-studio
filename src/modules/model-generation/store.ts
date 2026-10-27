import { reactive, ref } from 'vue'
import { useEditorTabs } from '../../shared/components/editor-shell'
import type { PartAsset } from '../../shared/parts/schema'

export interface GenerationTab { id: string; part?: PartAsset; jobId: string }
// Keep user input and queue presentation separate from the selected result tab.
export const generationInput = ref<PartAsset>()
export const generationQueueExpanded = ref(false)
// Keep open image tabs when navigating between editor modules.
export const generationTabs = useEditorTabs<GenerationTab>({
  prefix: 'model-generation', autoEmptyTab: true,
  factory: id => reactive({ id, part: undefined, jobId: '' } as GenerationTab),
})
