import React, { Suspense, lazy, useState, useEffect, useRef, useCallback } from "react"
import TaskTable, { CompletedClients } from "./components/TimelineTable"
import { categorizeTasks, extractBrandName } from "./lib/sheetsApi"
import { loadTeamMembers, taskOwnerNames } from "./lib/teamConfig"
import { cachePendingWrites, cacheSharedState, loadCachedSharedState, loadPendingWrites, mergeRemote, normalizeBrandKey, parseSheetUrl, sheetsFromLegacyHash, tabKey, taskKey as sharedTaskKey } from "./lib/sharedState"
import { deleteTeamAvatar, fetchSystemAnalytics, fetchSystemState, patchSystemState, renameSystemBrand, systemSyncStatus, triggerSystemSync, updateSystemCompletion, uploadTeamAvatar } from "./lib/fullSystem"
import { isSupabaseConfigured, supabase } from "./lib/supabase"
import TeamFilterBar from "./components/TeamFilterBar"
import TeamManager from "./components/TeamManager"
import MyWorkView from "./components/MyWorkView"
import AdminSettings from "./components/AdminSettings"
import NotificationCenter from "./components/NotificationCenter"
import TaskPanel from "./components/TaskPanel"
import Emoji from "./components/Emoji"
import { useAuth } from "./lib/auth"
import { bangkokDate } from "./lib/dates"
import magicLogo from "./assets/magic-logo.svg"

const DashboardView = lazy(() => import("./components/DashboardView"))

function sessionValue(key, fallback = null) {
  try {
    const value = sessionStorage.getItem(key) ?? localStorage.getItem(key)
    if (value !== null) sessionStorage.setItem(key, value)
    localStorage.removeItem(key)
    return value ?? fallback
  } catch { return fallback }
}

function overlayPendingRecords(base, pending, resource) {
  const next = { ...(base || {}) }
  pending.filter((item) => item.resource === resource).forEach(({ key, value }) => {
    if (value === null || value === "" || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)) delete next[key]
    else next[key] = value
  })
  return next
}

function overlayPendingSheets(base, pending) {
  const next = Object.fromEntries((base || []).map((sheet) => [sheet.spreadsheetId, sheet]))
  pending.filter((item) => item.resource === "sheets").forEach(({ key, value }) => {
    if (value === null) delete next[key]
    else {
      const sheet = parseSheetUrl(value)
      if (sheet) next[key] = sheet
    }
  })
  return Object.values(next)
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconWarning({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

const SYNC_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes between auto-syncs

export default function App() {
  const { access, user, signOut } = useAuth()
  const isAdmin = access?.role === "admin" && isSupabaseConfigured
  const canManageAssignments = isSupabaseConfigured
  const [cachedShared] = useState(loadCachedSharedState)
  const [initialPendingWrites] = useState(loadPendingWrites)
  const [now, setNow] = useState(() => Date.now())
  const [sheets, setSheets] = useState(() => {
    let base = cachedShared?.sheets
    if (!base) try { base = JSON.parse(sessionValue("magic-sheets", "[]")).map((s) => parseSheetUrl(s.url)).filter(Boolean) }
    catch { base = [] }
    return overlayPendingSheets(base, initialPendingWrites)
  })
  const [inputUrl, setInputUrl]     = useState("")
  const [isSyncing, setIsSyncing]   = useState(false)
  // Restore cached live data so the page shows real data immediately on reload
  const [liveTasks, setLiveTasks]   = useState(() => {
    try {
      const cached = JSON.parse(sessionValue("magic-live-task-rows", sessionValue("magic-live-tasks", "null")))
      return cached ? categorizeTasks(Array.isArray(cached) ? cached : cached.allTasks || []) : null
    }
    catch { return null }
  })
  const [syncError, setSyncError]   = useState(null)
  const [lastSynced, setLastSynced] = useState(() => {
    const ts = sessionValue("magic-last-synced")
    return ts ? new Date(ts) : null
  })
  const [viewMode, setViewMode] = useState(() => {
    const saved = localStorage.getItem(`magic-view:${user?.email || "legacy"}`)
    return saved || (access?.role === "employee" ? "my" : "dashboard")
  })
  const tableFilterKey = `magic-table-member:${user?.email || "legacy"}`
  const [filterMember, setFilterMember] = useState(() => localStorage.getItem(tableFilterKey) || null)
  const [showTeamManager, setShowTeamManager] = useState(false)
  const [showAdminSettings, setShowAdminSettings] = useState(false)
  const [teamMembers, setTeamMembers] = useState(() => {
    const pending = initialPendingWrites.find((item) => item.resource === "teamMembers")?.value
    return Array.isArray(pending) ? pending : Array.isArray(cachedShared?.teamMembers) ? cachedShared.teamMembers : loadTeamMembers()
  })
  const [sharedError, setSharedError] = useState(() => initialPendingWrites.length ? "มีข้อมูลที่ยังบันทึกไม่สำเร็จ กด Retry เพื่อส่งเข้าระบบกลาง" : null)
  const [saveStatus, setSaveStatus] = useState(() => Object.fromEntries(initialPendingWrites.map(({ resource, key }) => [`${resource}:${key}`, "failed"])))
  const [brands, setBrands] = useState(() => overlayPendingRecords(cachedShared?.brands, initialPendingWrites, "brands"))
  const [workflow, setWorkflow] = useState(() => overlayPendingRecords(cachedShared?.workflow, initialPendingWrites, "workflow"))
  const [noteVersions, setNoteVersions] = useState(() => cachedShared?.noteVersions || {})
  const [noteConflicts, setNoteConflicts] = useState({})
  const [dailyMetrics, setDailyMetrics] = useState([])
  const [taskEvents, setTaskEvents] = useState([])
  const [syncStatus, setSyncStatus] = useState(null)
  const [selectedTaskKey, setSelectedTaskKey] = useState(null)
  const syncingRef = useRef(false)
  const refreshVersionRef = useRef(0)
  const completionLocksRef = useRef(new Set())
  const dirtyRef = useRef(new Set(initialPendingWrites.map(({ resource, key }) => `${resource}:${key}`)))
  const pendingWritesRef = useRef(new Map(initialPendingWrites.map((item) => [`${item.resource}:${item.key}`, item])))
  const writeVersionsRef = useRef(new Map())
  const writeChainsRef = useRef(new Map())
  const addSheetInFlightRef = useRef(false)

  const refreshAnalytics = useCallback(async () => {
    if (viewMode !== "dashboard" || !isSupabaseConfigured) return null
    try {
      const analytics = await fetchSystemAnalytics()
      setDailyMetrics(analytics.dailyMetrics)
      setTaskEvents(analytics.taskEvents)
      return analytics
    } catch (error) {
      setSharedError(`โหลด Trend/Activity ไม่สำเร็จ: ${error.message}`)
      return null
    }
  }, [viewMode])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const [remarks, setRemarks] = useState(() => {
    let base = cachedShared?.remarks
    if (!base) try { base = JSON.parse(sessionValue("magic-remarks", "{}")) }
    catch { base = {} }
    return overlayPendingRecords(base, initialPendingWrites, "remarks")
  })
  const [priorities, setPriorities] = useState(() => {
    let base = cachedShared?.priorities
    if (!base) try { base = JSON.parse(sessionValue("magic-priorities", "{}")) }
    catch { base = {} }
    return overlayPendingRecords(base, initialPendingWrites, "priorities")
  })
  const [assignments, setAssignments] = useState(() => {
    let base = cachedShared?.assignments
    if (!base) try { base = JSON.parse(sessionValue("magic-assignments", "{}")) }
    catch { base = {} }
    return overlayPendingRecords(base, initialPendingWrites, "assignments")
  })

  const persistShared = useCallback(async (resource, key, value, mutation = value, options = {}) => {
    const dirtyKey = `${resource}:${key}`
    const version = (writeVersionsRef.current.get(dirtyKey) || 0) + 1
    writeVersionsRef.current.set(dirtyKey, version)
    dirtyRef.current.add(dirtyKey)
    pendingWritesRef.current.set(dirtyKey, { resource, key, value, mutation, options })
    cachePendingWrites([...pendingWritesRef.current.values()])
    setSaveStatus((prev) => ({ ...prev, [dirtyKey]: "saving" }))
    const previous = writeChainsRef.current.get(dirtyKey) || Promise.resolve()
    const request = previous.catch(() => {}).then(() => patchSystemState(resource, key, mutation, options))
    writeChainsRef.current.set(dirtyKey, request)
    try {
      const result = await request
      if (writeVersionsRef.current.get(dirtyKey) === version) {
        refreshVersionRef.current += 1
        dirtyRef.current.delete(dirtyKey)
        pendingWritesRef.current.delete(dirtyKey)
        cachePendingWrites([...pendingWritesRef.current.values()])
        setSaveStatus((prev) => ({ ...prev, [dirtyKey]: "saved" }))
        if (resource === "remarks") {
          if (Number.isInteger(result?.noteVersion)) setNoteVersions((current) => ({ ...current, [key]: result.noteVersion }))
          setNoteConflicts((current) => { const next = { ...current }; delete next[key]; return next })
        }
        if (result?.warning) setSharedError(`บันทึกสำเร็จ แต่ ${result.warning}`)
        else if (pendingWritesRef.current.size === 0) setSharedError(null)
      }
      refreshAnalytics()
      return true
    } catch (error) {
      if (writeVersionsRef.current.get(dirtyKey) === version) {
        setSaveStatus((prev) => ({ ...prev, [dirtyKey]: "failed" }))
        if (resource === "remarks" && error.status === 409) {
          setNoteConflicts((current) => ({ ...current, [key]: error.data }))
          setRemarks((current) => error.data.currentNote ? { ...current, [key]: error.data.currentNote } : Object.fromEntries(Object.entries(current).filter(([recordKey]) => recordKey !== key)))
          setNoteVersions((current) => ({ ...current, [key]: error.data.noteVersion || 0 }))
          setSharedError("Note มีการแก้ไขจากอีกหน้าจอ กรุณาเลือกโหลดค่าล่าสุดหรือบันทึกทับ")
        } else setSharedError(`${error.message} — ข้อมูลยังอยู่ในเครื่อง กด Retry เพื่อบันทึกอีกครั้ง`)
      }
      return false
    } finally {
      if (writeChainsRef.current.get(dirtyKey) === request) writeChainsRef.current.delete(dirtyKey)
    }
  }, [refreshAnalytics])

  const retryPendingWrites = useCallback(() => {
    const pending = [...pendingWritesRef.current.values()]
    return Promise.all(pending.map(({ resource, key, value, mutation, options }) => persistShared(resource, key, value, mutation, options)))
  }, [persistShared])

  const refreshShared = useCallback(async () => {
    const requestVersion = ++refreshVersionRef.current
    try {
      const remote = await fetchSystemState()
      if (requestVersion !== refreshVersionRef.current) return null
      setSheets((local) => {
        const remoteMap = Object.fromEntries((remote.sheets || []).map((sheet) => [sheet.spreadsheetId, sheet]))
        const localIds = new Set(local.map((sheet) => sheet.spreadsheetId))
        local.forEach((sheet) => {
          if (dirtyRef.current.has(`sheets:${sheet.spreadsheetId}`)) remoteMap[sheet.spreadsheetId] = sheet
        })
        dirtyRef.current.forEach((dirtyKey) => {
          if (dirtyKey.startsWith("sheets:") && !localIds.has(dirtyKey.slice(7))) delete remoteMap[dirtyKey.slice(7)]
        })
        return Object.values(remoteMap)
      })
      if (!dirtyRef.current.has("teamMembers:all") && Array.isArray(remote.teamMembers)) {
        setTeamMembers(remote.teamMembers)
      }
      setBrands((local) => mergeRemote(local, remote.brands, dirtyRef.current, "brands"))
      setAssignments((local) => mergeRemote(local, remote.assignments, dirtyRef.current, "assignments"))
      setRemarks((local) => mergeRemote(local, remote.remarks, dirtyRef.current, "remarks"))
      setPriorities((local) => mergeRemote(local, remote.priorities, dirtyRef.current, "priorities"))
      setWorkflow((local) => mergeRemote(local, remote.workflow, dirtyRef.current, "workflow"))
      setNoteVersions(remote.noteVersions || {})
      setSyncStatus(remote.syncStatus || null)
      if (remote.tasks) {
        setLiveTasks((local) => {
          const localByKey = new Map((local?.allTasks || []).map((task) => [sharedTaskKey(task), task]))
          const tasks = remote.tasks.map((task) => completionLocksRef.current.has(sharedTaskKey(task)) ? localByKey.get(sharedTaskKey(task)) || task : task)
          return categorizeTasks(tasks)
        })
      }
      if (remote.updatedAt) setLastSynced(new Date(remote.updatedAt))
      cacheSharedState({ ...remote, tasks: undefined })
      if (pendingWritesRef.current.size === 0) setSharedError(null)
      return remote
    } catch (error) {
      if (requestVersion !== refreshVersionRef.current) return null
      setSharedError(`${error.message} — กำลังใช้ข้อมูล cache ในเครื่อง`)
      return null
    }
  }, [])

  useEffect(() => {
    if (viewMode !== "dashboard" || !isSupabaseConfigured) return undefined
    refreshAnalytics()
    const timer = setInterval(refreshAnalytics, 30_000)
    return () => clearInterval(timer)
  }, [refreshAnalytics, viewMode])

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined
    let refreshTimer
    const scheduleRefresh = () => {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(refreshShared, 150)
    }
    const channel = supabase
      .channel("timeline-shared-state")
      .on("postgres_changes", { event: "*", schema: "public", table: "sheets" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_workflow" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "assignments" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "brands" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_runs" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_events" }, refreshAnalytics)
      .subscribe()
    return () => { clearTimeout(refreshTimer); supabase.removeChannel(channel) }
  }, [refreshAnalytics, refreshShared])

  useEffect(() => {
    refreshShared()
    const timer = setInterval(refreshShared, 30_000)
    const onVisibility = () => { if (document.visibilityState === "visible") refreshShared() }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("focus", refreshShared)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("focus", refreshShared)
    }
  }, [refreshShared])

  useEffect(() => {
    const legacySheets = sheetsFromLegacyHash(window.location.hash)
    if (legacySheets.length === 0) return
    if (!isAdmin || !window.confirm(`Import Google Sheets ${legacySheets.length} รายการเข้าสู่ระบบกลาง?`)) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`)
      return
    }
    Promise.all(legacySheets.map((sheet) => persistShared("sheets", sheet.spreadsheetId, sheet.url))).then((results) => {
      if (!results.every(Boolean)) return
      setSheets((current) => {
        const byId = Object.fromEntries(current.map((sheet) => [sheet.spreadsheetId, sheet]))
        legacySheets.forEach((sheet) => { byId[sheet.spreadsheetId] = sheet })
        return Object.values(byId)
      })
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`)
    })
  }, [isAdmin, persistShared])

  useEffect(() => {
    localStorage.setItem(`magic-view:${user?.email || "legacy"}`, viewMode)
  }, [user?.email, viewMode])

  useEffect(() => {
    if (filterMember) localStorage.setItem(tableFilterKey, filterMember)
    else localStorage.removeItem(tableFilterKey)
  }, [filterMember, tableFilterKey])

  const updateTeamMembers = (newMembers) => {
    setTeamMembers(newMembers)
    return persistShared("teamMembers", "all", newMembers)
  }

  const updateTeamAvatar = async (idx, dataUrl) => {
    try {
      const avatar = await uploadTeamAvatar(dataUrl)
      const previous = teamMembers[idx]?.avatar
      const saved = await updateTeamMembers(teamMembers.map((member, index) => index === idx ? { ...member, avatar } : member))
      if (saved && previous) deleteTeamAvatar(previous).catch(() => {})
      return true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }

  const removeTeamAvatar = async (idx) => {
    const previous = teamMembers[idx]?.avatar
    const saved = await updateTeamMembers(teamMembers.map((member, index) => index === idx ? { ...member, avatar: "" } : member))
    if (saved && previous) deleteTeamAvatar(previous).catch(() => {})
    return saved
  }

  const updateRecord = useCallback((resource, setter, key, value) => {
    if (!isSupabaseConfigured) {
      setSharedError("โหมด Localhost นี้เป็นแบบอ่านอย่างเดียวจนกว่าจะเชื่อม Supabase")
      return Promise.resolve(false)
    }
    setter((prev) => {
      const next = { ...prev }
      if (value !== null && value !== "" && (typeof value !== "object" || Object.keys(value).length > 0)) next[key] = value
      else delete next[key]
      return next
    })
    return persistShared(resource, key, value || null)
  }, [persistShared])

  const updateRemark = useCallback((key, value, options = {}) => {
    if (!isSupabaseConfigured) return updateRecord("remarks", setRemarks, key, value)
    setRemarks((current) => {
      const next = { ...current }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
    const expectedNoteVersion = options.expectedNoteVersion ?? noteVersions[key] ?? 0
    return persistShared("remarks", key, value, value || null, { ...options, expectedNoteVersion })
  }, [noteVersions, persistShared, updateRecord])
  const discardRemarkConflict = useCallback((key, value, version) => {
    const dirtyKey = `remarks:${key}`
    writeVersionsRef.current.set(dirtyKey, (writeVersionsRef.current.get(dirtyKey) || 0) + 1)
    dirtyRef.current.delete(dirtyKey)
    pendingWritesRef.current.delete(dirtyKey)
    cachePendingWrites([...pendingWritesRef.current.values()])
    setRemarks((current) => value ? { ...current, [key]: value } : Object.fromEntries(Object.entries(current).filter(([recordKey]) => recordKey !== key)))
    setNoteVersions((current) => ({ ...current, [key]: version }))
    setNoteConflicts((current) => { const next = { ...current }; delete next[key]; return next })
    setSaveStatus((current) => { const next = { ...current }; delete next[dirtyKey]; return next })
    if (pendingWritesRef.current.size === 0) setSharedError(null)
  }, [])
  const updatePriority = useCallback((key, value) => updateRecord("priorities", setPriorities, key, value), [updateRecord])
  const updateWorkflow = useCallback((key, value) => updateRecord("workflow", setWorkflow, key, value), [updateRecord])
  const updateAssignment = useCallback((key, value, mutation) => {
    if (!isSupabaseConfigured) {
      setSharedError("โหมด Localhost นี้เป็นแบบอ่านอย่างเดียวจนกว่าจะเชื่อม Supabase")
      return Promise.resolve(false)
    }
    setAssignments((current) => ({ ...current, [key]: value }))
    return persistShared("assignments", key, value, mutation)
  }, [persistShared])
  const updateBrand = useCallback((key, value) => updateRecord("brands", setBrands, key, value), [updateRecord])
  const renameBrand = useCallback(async (oldName, newName, tabs) => {
    try {
      await renameSystemBrand(oldName, newName, tabs.map((tab) => tab.key))
      await refreshShared()
      return true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }, [refreshShared])
  const seededBrandsRef = useRef(false)

  useEffect(() => {
    if (seededBrandsRef.current || !liveTasks?.allTasks?.length || Object.keys(brands).length > 0) return
    seededBrandsRef.current = true
    try {
      const local = JSON.parse(localStorage.getItem("magic-brand-names") || "null")
      Object.entries(local?.confirmedBrands || {}).forEach(([brandName, data]) => {
        liveTasks.allTasks
          .filter((task) => data.tabs?.includes(task.clientName))
          .forEach((task) => updateBrand(tabKey(task), brandName))
      })
      localStorage.removeItem("magic-brand-names")
    } catch { /* legacy brand cache is optional */ }
  }, [brands, liveTasks, updateBrand])

  const brandNameForTask = useCallback((task) => brands[tabKey(task)] || extractBrandName(task.clientName), [brands])
  const assignmentKeyForTask = useCallback((task) => normalizeBrandKey(brandNameForTask(task)), [brandNameForTask])
  const assignmentForTask = useCallback((task) => assignments[assignmentKeyForTask(task)] || assignments[task.clientName] || {}, [assignments, assignmentKeyForTask])
  const canEditTask = useCallback(() => isSupabaseConfigured, [])
  const openTask = useCallback((taskOrKey) => setSelectedTaskKey(typeof taskOrKey === "string" ? taskOrKey : sharedTaskKey(taskOrKey)), [])

  const applyTaskCompletion = (task, done, actualSubmit) => {
    const match = (candidate) => candidate.spreadsheetId === task.spreadsheetId &&
      candidate.sheetGid === task.sheetGid && candidate.taskId === task.taskId
    setLiveTasks((prev) => {
      if (!prev) return prev
      const nextTasks = prev.allTasks.map((candidate) => match(candidate) ? { ...candidate, done, actualSubmit } : candidate)
      return categorizeTasks(nextTasks)
    })
  }

  // Optimistic update with rollback when Apps Script rejects the write.
  const toggleTask = async (task, newDone) => {
    if (!isSupabaseConfigured) {
      setSyncError("โหมด Localhost นี้เป็นแบบอ่านอย่างเดียวจนกว่าจะเชื่อม Supabase")
      return false
    }
    const key = sharedTaskKey(task)
    if (completionLocksRef.current.has(key)) return false
    completionLocksRef.current.add(key)
    const newActualSubmit = newDone ? bangkokDate() : null
    applyTaskCompletion(task, newDone, newActualSubmit)
    let saved = false
    try {
      if (isSupabaseConfigured) {
        const result = await updateSystemCompletion(task, newDone, newActualSubmit)
        if (result.snapshotPending) {
          setSharedError(result.warning)
          await syncData(true)
        }
        saved = true
        await refreshShared()
      } else {
        throw new Error("Completion requires the authenticated full-system runtime")
      }
    } catch (error) {
      setSyncError(error.message)
    }
    if (!saved) {
      applyTaskCompletion(task, task.done, task.actualSubmit || null)
      setSyncError("บันทึกสถานะกลับ Google Sheet ไม่สำเร็จ ระบบคืนค่าเดิมแล้ว กรุณาลองใหม่")
    }
    completionLocksRef.current.delete(key)
    return saved
  }

  // Persist live tasks cache + last synced timestamp
  useEffect(() => {
    if (!liveTasks) return
    try {
      sessionStorage.setItem("magic-live-task-rows", JSON.stringify(liveTasks.allTasks))
      sessionStorage.removeItem("magic-live-tasks")
    } catch { /* cache is optional */ }
  }, [liveTasks])
  useEffect(() => {
    if (lastSynced) try { sessionStorage.setItem("magic-last-synced", lastSynced.toISOString()) }
    catch { /* cache is optional */ }
  }, [lastSynced])

  // ── Filter by team member ──
  // Explicit Responsibility wins; brand assignment is the fallback.
  const memberFilter = (task) => {
    if (!filterMember) return true
    return taskOwnerNames(task, teamMembers, assignmentForTask(task)).includes(filterMember)
  }

  const rawOverdue = liveTasks?.overdue || []
  const rawUpcoming = liveTasks?.upcoming || []
  const rawUnscheduled = liveTasks?.unscheduled || []
  const displayClientStats = liveTasks?.clientStats || {}
  const rawAllTasks = liveTasks?.allTasks || []
  const selectedTask = rawAllTasks.find((task) => sharedTaskKey(task) === selectedTaskKey) || null

  const displayOverdue  = filterMember ? rawOverdue.filter(memberFilter)  : rawOverdue
  const displayUpcoming = filterMember ? rawUpcoming.filter(memberFilter) : rawUpcoming
  const displayUnscheduled = filterMember ? rawUnscheduled.filter(memberFilter) : rawUnscheduled
  const displayAllTasks = filterMember ? rawAllTasks.filter(memberFilter) : rawAllTasks
  const myMemberName = access?.member_name || ""
  const myTasks = myMemberName
    ? rawAllTasks.filter((task) => taskOwnerNames(task, teamMembers, assignmentForTask(task)).includes(myMemberName))
    : []

  const tableProps = {
    clientStats: displayClientStats,
    remarks,
    onUpdateRemark: updateRemark,
    priorities,
    onUpdatePriority: updatePriority,
    assignments,
    teamMembers,
    onUpdateAssignment: updateAssignment,
    brandNameForTask,
    assignmentKeyForTask,
    saveStatus,
    onToggle: toggleTask,
    onOpenTask: openTask,
    workflow,
    onUpdateWorkflow: updateWorkflow,
    canManageAssignments,
    canEditTask,
  }

  const addSheet = async () => {
    if (addSheetInFlightRef.current) return
    const sheet = parseSheetUrl(inputUrl)
    if (!sheet) {
      setSharedError("URL Google Sheet ไม่ถูกต้อง")
      return
    }
    if (sheets.some((current) => current.spreadsheetId === sheet.spreadsheetId)) {
      setSharedError("Google Sheet นี้เชื่อมต่ออยู่แล้ว")
      return
    }
    addSheetInFlightRef.current = true
    try {
      if (!isSupabaseConfigured) {
        setSheets((current) => {
          const next = [...current, sheet]
          try { sessionStorage.setItem("magic-sheets", JSON.stringify(next)) } catch { /* local preview cache is optional */ }
          return next
        })
        setInputUrl("")
        setSharedError("เพิ่ม Sheet ใน Local Preview แล้ว — ข้อมูลนี้ยังไม่แชร์กับคนอื่นจนกว่าจะเชื่อม Supabase")
        return
      }
      const saved = await persistShared("sheets", sheet.spreadsheetId, sheet.url)
      if (!saved) return
      setSheets((prev) => prev.some((current) => current.spreadsheetId === sheet.spreadsheetId) ? prev : [...prev, sheet])
      setInputUrl("")
    } finally { addSheetInFlightRef.current = false }
  }

  const removeSheet = async (spreadsheetId) => {
    if (!isSupabaseConfigured) {
      setSheets((current) => {
        const next = current.filter((sheet) => sheet.spreadsheetId !== spreadsheetId)
        try { sessionStorage.setItem("magic-sheets", JSON.stringify(next)) } catch { /* local preview cache is optional */ }
        return next
      })
      return
    }
    const saved = await persistShared("sheets", spreadsheetId, null)
    if (!saved) return
    setSheets((prev) => prev.filter((sheet) => sheet.spreadsheetId !== spreadsheetId))
  }

  const syncData = useCallback(async (force = false) => {
    if (syncingRef.current || sheets.length === 0) return
    syncingRef.current = true
    setIsSyncing(true)
    setSyncError(null)
    try {
      if (isSupabaseConfigured) {
        const started = await triggerSystemSync(force)
        if (started?.status === "running") {
          if (!started.runId) throw new Error("Sync is running but its run ID is unavailable")
          for (let attempt = 0; attempt < 60; attempt++) {
            const current = await systemSyncStatus(started.runId)
            setSyncStatus(current)
            if (current.status === "success") break
            if (current.status === "failed") throw new Error(current.error || "Sync failed")
            if (attempt === 59) throw new Error("Sync is still running. Check Data Health in a moment.")
            await new Promise((resolve) => setTimeout(resolve, 1500))
          }
        }
        await refreshShared()
        await refreshAnalytics()
      } else {
        throw new Error("ต้องเชื่อม Supabase ก่อนจึงจะ Sync ข้อมูลกลางได้")
      }
    } catch (err) {
      const msg = err.message || ""
      setSyncError(
        msg.includes("429") || msg.toLowerCase().includes("quota")
          ? "API quota เต็มชั่วคราว — Google Sheets อนุญาตสูงสุด 60 requests/นาที กรุณารอ 1-2 นาทีแล้ว Sync ใหม่"
          : msg
      )
    } finally {
      syncingRef.current = false
      setIsSyncing(false)
    }
  }, [refreshAnalytics, refreshShared, sheets])

  const sheetSignatureRef = useRef("")
  useEffect(() => {
    const signature = sheets.map((sheet) => sheet.spreadsheetId).sort().join(",")
    if (!signature) {
      queueMicrotask(() => setLiveTasks(null))
      sheetSignatureRef.current = ""
      return
    }
    const sheetListChanged = signature !== sheetSignatureRef.current
    sheetSignatureRef.current = signature
    const cacheExpired = !lastSynced || Date.now() - lastSynced.getTime() >= SYNC_COOLDOWN_MS
    if (isSupabaseConfigured && (sheetListChanged || cacheExpired)) syncData()
  }, [sheets, lastSynced, syncData])

  return (
    <div className="min-h-screen bg-[var(--ui-canvas)] text-[var(--ui-text)]">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-[var(--ui-border)] bg-white">
        {/* Row 1: Logo + View tabs + actions */}
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2">
          {/* Left: Logo + Brand */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <img src={magicLogo} alt="MAGIC Digital Marketing Agency" className="h-7 w-7 sm:h-8 sm:w-8 object-contain" />
            <div className="hidden sm:block leading-tight">
              <span className="text-sm font-black tracking-tight text-purple-900">MAGIC</span>
              <span className="ml-1 text-sm font-normal text-[var(--ui-muted)]">Timeline</span>
            </div>
          </div>

          <div className="h-6 w-px bg-[var(--ui-border)] shrink-0" />

          {/* Center: View tabs */}
          <div className="flex items-center gap-0.5 rounded-lg bg-[var(--ui-surface-subtle)] p-0.5 shrink-0">
            {[
              { mode: "my", label: "My Work", icon: "M9 12l2 2 4-4M5 4h14v16H5z" },
              { mode: "table", label: "Explorer", icon: "M3 10h18M3 6h18M3 14h18M3 18h18" },
              { mode: "dashboard", label: "Timeline", icon: "M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-2a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" },
            ].map(({ mode, label, icon }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                aria-label={label}
                aria-current={viewMode === mode ? "page" : undefined}
                className={`flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors duration-150 sm:min-h-0 sm:min-w-0 sm:px-2.5 ${
                  viewMode === mode
                    ? "bg-[var(--ui-brand-soft)] text-[var(--ui-brand)]"
                    : "text-[var(--ui-muted)] hover:bg-white hover:text-[var(--ui-text)]"
                }`}
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                </svg>
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {viewMode === "table" && (
            <>
              <div className="hidden sm:block h-6 w-px bg-[var(--ui-border)] shrink-0" />
              <div className="hidden sm:flex flex-1 min-w-0 overflow-x-auto scrollbar-hide">
                <TeamFilterBar activeMember={filterMember} onSelect={setFilterMember} members={teamMembers} />
              </div>
            </>
          )}

          {/* Right: actions */}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <span className="hidden rounded-full bg-purple-100 px-2 py-1 text-[9px] font-bold uppercase text-purple-600 lg:block">{access?.role}</span>
            {viewMode === "table" && filterMember && (
              <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[9px] font-medium text-purple-500 hidden lg:block">
                Filtered: <strong>{filterMember}</strong>
              </span>
            )}
            {isAdmin && <button
              onClick={() => setShowTeamManager(true)}
              className="ui-button ui-button-secondary flex min-h-0 items-center gap-1 px-2 py-1 text-[10px] font-semibold"
              title={saveStatus["teamMembers:all"] === "saving" ? "กำลังบันทึก..." : "จัดการทีม"}
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="hidden sm:inline">จัดการทีม</span>
            </button>}
            <button onClick={() => setShowAdminSettings(true)} className="ui-button ui-button-secondary min-h-11 px-2 text-[10px] font-semibold sm:min-h-0"><Emoji name={isAdmin ? "admin" : "add"} /> {isAdmin ? "Admin" : "Add Sheet"}</button>
            <NotificationCenter configured={isSupabaseConfigured} email={user?.email} onOpenTask={openTask} />
            {isSupabaseConfigured && <button onClick={signOut} className="rounded-lg px-2 py-1 text-[10px] text-gray-400 hover:bg-gray-50 hover:text-gray-600" title={user?.email}>Sign out</button>}
            <span className="rounded-md bg-purple-50 px-2 py-1 text-[10px] font-semibold text-purple-500 tabular-nums hidden md:block">
              {new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
            </span>
          </div>
        </div>

        {/* Row 2 (mobile only): Filter chips — full width, easy to tap */}
        {viewMode === "table" && (
          <div className="sm:hidden overflow-x-auto scrollbar-hide border-t border-purple-100/60 px-3 py-1.5">
            <TeamFilterBar activeMember={filterMember} onSelect={setFilterMember} members={teamMembers} />
          </div>
        )}
      </header>

      <main className="p-3 sm:p-8 max-w-screen-2xl mx-auto">

        {sharedError && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <IconWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-xs text-amber-700">{sharedError}</p>
            {Object.values(saveStatus).includes("failed") && (
              <button
                onClick={retryPendingWrites}
                className="ml-auto rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
              >
                <Emoji name="retry" /> Retry
              </button>
            )}
            <button onClick={() => setSharedError(null)} aria-label="ปิดข้อความแจ้งเตือน" className="-my-2 -mr-2 flex min-h-11 min-w-11 items-center justify-center text-xs text-amber-500 hover:text-amber-700">✕</button>
          </div>
        )}

        {/* Team Manager Modal */}
        {isAdmin && <TeamManager
          members={teamMembers}
          onUpdate={updateTeamMembers}
          onUploadAvatar={updateTeamAvatar}
          onRemoveAvatar={removeTeamAvatar}
          open={showTeamManager}
          onClose={() => setShowTeamManager(false)}
        />}
        <AdminSettings open={showAdminSettings} onClose={() => setShowAdminSettings(false)} currentEmail={user?.email} members={teamMembers} configured={isSupabaseConfigured} isAdmin={isAdmin} onSaved={refreshShared} dataSources={{ sheets, inputUrl, setInputUrl, addSheet, removeSheet, syncData, isSyncing, lastSynced, syncError }} />

        {lastSynced && now - lastSynced.getTime() > 24 * 60 * 60 * 1000 && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <Emoji name="warning" /> ข้อมูลเก่ากว่า 24 ชั่วโมง — ข้อมูล ณ {lastSynced.toLocaleString("th-TH")}
          </div>
        )}

        <div key={viewMode}>
        {viewMode === "my" ? (
          <MyWorkView tasks={myTasks} memberName={myMemberName} workflow={workflow} preferenceOwner={user?.email || "local"} tableProps={{ ...tableProps, clientStats: displayClientStats }} />
        ) : viewMode === "table" ? (
          <>
            {/* ── Overdue Tasks ───────────────────────────────────────────────── */}
            <TaskTable
              title="Overdue Tasks"
              titleEmoji="overdue"
              badge="bg-red-400"
              tasks={displayOverdue}
              isLoading={isSyncing}
              {...tableProps}
            />

            {/* ── Upcoming Deadlines ──────────────────────────────────────────── */}
            <TaskTable
              title="Upcoming Deadlines"
              titleEmoji="upcoming"
              badge="bg-purple-400"
              tasks={displayUpcoming}
              isLoading={isSyncing}
              {...tableProps}
            />

            <TaskTable
              title="Unscheduled"
              titleEmoji="unscheduled"
              badge="bg-slate-400"
              tasks={displayUnscheduled}
              isLoading={isSyncing}
              {...tableProps}
            />

            {/* ── Completed Clients (100% done) ────────────────────────────── */}
            <CompletedClients
              allTasks={displayAllTasks}
              assignments={assignments}
              teamMembers={teamMembers}
              onUpdateAssignment={updateAssignment}
              brandNameForTask={brandNameForTask}
              assignmentKeyForTask={assignmentKeyForTask}
              canManageAssignments={canManageAssignments}
            />
          </>
        ) : (
          /* ── Dashboard View ───────────────────────────────────────────────── */
          <Suspense fallback={<div className="ui-card rounded-2xl p-10 text-center text-sm text-[var(--ui-muted)]">Loading management overview…</div>}><DashboardView
            allTasks={rawAllTasks}
            assignments={assignments}
            onUpdateAssignment={updateAssignment}
            teamMembers={teamMembers}
            brands={brands}
            onUpdateBrand={updateBrand}
            onRenameBrand={renameBrand}
            brandNameForTask={brandNameForTask}
            assignmentKeyForTask={assignmentKeyForTask}
            workflow={workflow}
            dailyMetrics={dailyMetrics}
            taskEvents={taskEvents}
            syncStatus={syncStatus}
            lastSynced={lastSynced}
            canAdmin={isAdmin}
            canManageAssignments={canManageAssignments}
            preferenceOwner={user?.email || "local"}
            onOpenTask={openTask}
          /></Suspense>
        )}
        </div>

      </main>
      {selectedTaskKey && <TaskPanel
        key={selectedTaskKey}
        taskKey={selectedTaskKey}
        task={selectedTask}
        brandName={selectedTask ? brandNameForTask(selectedTask) : ""}
        note={remarks[selectedTaskKey] || ""}
        noteVersion={noteVersions[selectedTaskKey] || 0}
        noteConflict={noteConflicts[selectedTaskKey] || null}
        priority={priorities[selectedTaskKey] || ""}
        workflow={workflow[selectedTaskKey] || "not_started"}
        saveStatus={saveStatus}
        configured={isSupabaseConfigured}
        editable={selectedTask ? canEditTask(selectedTask) : false}
        onUpdateNote={updateRemark}
        onDiscardNoteConflict={discardRemarkConflict}
        onUpdatePriority={updatePriority}
        onUpdateWorkflow={updateWorkflow}
        onToggleDone={toggleTask}
        onRefresh={refreshShared}
        onClose={() => setSelectedTaskKey(null)}
      />}
    </div>
  )
}
