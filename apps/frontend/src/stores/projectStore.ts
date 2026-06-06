import { create } from 'zustand'

interface ProjectState {
  selectedProjectId: string | null
  selectProject: (id: string) => void
  clearProject: () => void
}

export const useProjectStore = create<ProjectState>()((set) => ({
  selectedProjectId: null,
  selectProject: (id) => set({ selectedProjectId: id }),
  clearProject: () => set({ selectedProjectId: null }),
}))
