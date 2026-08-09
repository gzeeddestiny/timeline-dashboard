import React, { Suspense, lazy, useState, useEffect, useRef, useCallback } from "react"
import TaskTable, { CompletedClients } from "./components/TimelineTable"
import { categorizeTasks, extractBrandName } from "./lib/sheetsApi"
import { matchMembers, loadTeamMembers, saveTeamMembers, refreshTeamMembers } from "./lib/teamConfig"
import { cachePendingWrites, cacheSharedState, loadCachedSharedState, loadPendingWrites, mergeRemote, normalizeBrandKey, parseSheetUrl, sheetsFromLegacyHash, tabKey, taskKey as sharedTaskKey } from "./lib/sharedState"
import { fetchSystemState, patchSystemState, renameSystemBrand, systemSyncStatus, triggerSystemSync, updateSystemCompletion } from "./lib/fullSystem"
import { isSupabaseConfigured, supabase } from "./lib/supabase"
import TeamFilterBar from "./components/TeamFilterBar"
import TeamManager from "./components/TeamManager"
import MyWorkView from "./components/MyWorkView"
import AdminSettings from "./components/AdminSettings"
import NotificationCenter from "./components/NotificationCenter"
import TaskPanel from "./components/TaskPanel"
import { useAuth } from "./lib/auth"
import { bangkokDate } from "./lib/dates"
import magicLogo from "./assets/magic-logo.svg"

const DashboardView = lazy(() => import("./components/DashboardView"))

function sessionValue(key, fallback = null) {
  const value = sessionStorage.getItem(key) ?? localStorage.getItem(key)
  if (value !== null) sessionStorage.setItem(key, value)
  localStorage.removeItem(key)
  return value ?? fallback
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

function IconSync({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}
function IconCheck({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
function IconTrash({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}
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
    try { return JSON.parse(sessionValue("magic-live-tasks", "null")) }
    catch { return null }
  })
  const [syncError, setSyncError]   = useState(null)
  const [lastSynced, setLastSynced] = useState(() => {
    const ts = sessionValue("magic-last-synced")
    return ts ? new Date(ts) : null
  })
  const [copied, setCopied]         = useState(false)
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
  const [dailyMetrics, setDailyMetrics] = useState([])
  const [taskEvents, setTaskEvents] = useState([])
  const [syncStatus, setSyncStatus] = useState(null)
  const [selectedTaskKey, setSelectedTaskKey] = useState(null)
  const syncingRef = useRef(false)
  const dirtyRef = useRef(new Set(initialPendingWrites.map(({ resource, key }) => `${resource}:${key}`)))
  const pendingWritesRef = useRef(new Map(initialPendingWrites.map((item) => [`${item.resource}:${item.key}`, item])))
  const writeVersionsRef = useRef(new Map())
  const writeChainsRef = useRef(new Map())

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

  const persistShared = useCallback(async (resource, key, value, mutation = value) => {
    const dirtyKey = `${resource}:${key}`
    const version = (writeVersionsRef.current.get(dirtyKey) || 0) + 1
    writeVersionsRef.current.set(dirtyKey, version)
    dirtyRef.current.add(dirtyKey)
    pendingWritesRef.current.set(dirtyKey, { resource, key, value, mutation })
    cachePendingWrites([...pendingWritesRef.current.values()])
    setSaveStatus((prev) => ({ ...prev, [dirtyKey]: "saving" }))
    const previous = writeChainsRef.current.get(dirtyKey) || Promise.resolve()
    const request = previous.catch(() => {}).then(() => patchSystemState(resource, key, mutation))
    writeChainsRef.current.set(dirtyKey, request)
    try {
      const result = await request
      if (writeVersionsRef.current.get(dirtyKey) === version) {
        dirtyRef.current.delete(dirtyKey)
        pendingWritesRef.current.delete(dirtyKey)
        cachePendingWrites([...pendingWritesRef.current.values()])
        setSaveStatus((prev) => ({ ...prev, [dirtyKey]: "saved" }))
        if (result?.warning) setSharedError(`บันทึกสำเร็จ แต่ ${result.warning}`)
        else if (pendingWritesRef.current.size === 0) setSharedError(null)
      }
      return true
    } catch (error) {
      if (writeVersionsRef.current.get(dirtyKey) === version) {
        setSaveStatus((prev) => ({ ...prev, [dirtyKey]: "failed" }))
        setSharedError(`${error.message} — ข้อมูลยังอยู่ในเครื่อง กด Retry เพื่อบันทึกอีกครั้ง`)
      }
      return false
    } finally {
      if (writeChainsRef.current.get(dirtyKey) === request) writeChainsRef.current.delete(dirtyKey)
    }
  }, [])

  const retryPendingWrites = useCallback(() => {
    const pending = [...pendingWritesRef.current.values()]
    return Promise.all(pending.map(({ resource, key, value, mutation }) => persistShared(resource, key, value, mutation)))
  }, [persistShared])

  const refreshShared = useCallback(async () => {
    try {
      const remote = await fetchSystemState()
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
        saveTeamMembers(remote.teamMembers)
        refreshTeamMembers()
        setTeamMembers(remote.teamMembers)
      }
      setBrands((local) => mergeRemote(local, remote.brands, dirtyRef.current, "brands"))
      setAssignments((local) => mergeRemote(local, remote.assignments, dirtyRef.current, "assignments"))
      setRemarks((local) => mergeRemote(local, remote.remarks, dirtyRef.current, "remarks"))
      setPriorities((local) => mergeRemote(local, remote.priorities, dirtyRef.current, "priorities"))
      setWorkflow((local) => mergeRemote(local, remote.workflow, dirtyRef.current, "workflow"))
      setDailyMetrics(remote.dailyMetrics || [])
      setTaskEvents(remote.taskEvents || [])
      setSyncStatus(remote.syncStatus || null)
      if (remote.tasks) {
        const categorized = categorizeTasks(remote.tasks)
        setLiveTasks(categorized)
      }
      if (remote.updatedAt) setLastSynced(new Date(remote.updatedAt))
      cacheSharedState(remote)
      if (pendingWritesRef.current.size === 0) setSharedError(null)
      return remote
    } catch (error) {
      setSharedError(`${error.message} — กำลังใช้ข้อมูล cache ในเครื่อง`)
      return null
    }
  }, [])

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
      .subscribe()
    return () => { clearTimeout(refreshTimer); supabase.removeChannel(channel) }
  }, [refreshShared])

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

  useEffect(() => { sessionStorage.setItem("magic-sheets", JSON.stringify(sheets)) }, [sheets])
  useEffect(() => { sessionStorage.setItem("magic-remarks", JSON.stringify(remarks)) }, [remarks])
  useEffect(() => { sessionStorage.setItem("magic-priorities", JSON.stringify(priorities)) }, [priorities])
  useEffect(() => { sessionStorage.setItem("magic-assignments", JSON.stringify(assignments)) }, [assignments])
  useEffect(() => {
    if (filterMember) localStorage.setItem(tableFilterKey, filterMember)
    else localStorage.removeItem(tableFilterKey)
  }, [filterMember, tableFilterKey])

  const updateTeamMembers = (newMembers) => {
    saveTeamMembers(newMembers)
    refreshTeamMembers()
    setTeamMembers(newMembers)
    return persistShared("teamMembers", "all", newMembers)
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

  const updateRemark = useCallback((key, value) => updateRecord("remarks", setRemarks, key, value), [updateRecord])
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
  const openTask = useCallback((taskOrKey) => setSelectedTaskKey(typeof taskOrKey === "string" ? taskOrKey : sharedTaskKey(taskOrKey)), [])

  const applyTaskCompletion = (task, done, actualSubmit) => {
    const match = (candidate) => candidate.spreadsheetId === task.spreadsheetId &&
      candidate.sheetGid === task.sheetGid && candidate.taskId === task.taskId
    setLiveTasks((prev) => prev && ({
      ...prev,
      overdue: prev.overdue.map((candidate) => match(candidate) ? { ...candidate, done, actualSubmit } : candidate),
      upcoming: prev.upcoming.map((candidate) => match(candidate) ? { ...candidate, done, actualSubmit } : candidate),
      allTasks: prev.allTasks.map((candidate) => match(candidate) ? { ...candidate, done, actualSubmit } : candidate),
    }))
  }

  // Optimistic update with rollback when Apps Script rejects the write.
  const toggleTask = async (task, newDone) => {
    if (!isSupabaseConfigured) {
      setSyncError("โหมด Localhost นี้เป็นแบบอ่านอย่างเดียวจนกว่าจะเชื่อม Supabase")
      return false
    }
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
    return saved
  }

  // Persist live tasks cache + last synced timestamp
  useEffect(() => {
    if (liveTasks) sessionStorage.setItem("magic-live-tasks", JSON.stringify(liveTasks))
  }, [liveTasks])
  useEffect(() => {
    if (lastSynced) sessionStorage.setItem("magic-last-synced", lastSynced.toISOString())
  }, [lastSynced])

  const copyShareLink = () => {
    const stableUrl = `${window.location.origin}${window.location.pathname}`
    navigator.clipboard.writeText(stableUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── Filter by team member ──
  // Check BOTH: client-level assignment AND per-task responsibility
  const memberFilter = (task) => {
    if (!filterMember) return true
    if (Object.values(assignmentForTask(task)).includes(filterMember)) return true
    const members = matchMembers(task.responsibility)
    return members.some((m) => m.name === filterMember)
  }

  const rawOverdue = liveTasks?.overdue || []
  const rawUpcoming = liveTasks?.upcoming || []
  const displayClientStats = liveTasks?.clientStats || {}
  const rawAllTasks = liveTasks?.allTasks || []
  const selectedTask = rawAllTasks.find((task) => sharedTaskKey(task) === selectedTaskKey) || null

  const displayOverdue  = filterMember ? rawOverdue.filter(memberFilter)  : rawOverdue
  const displayUpcoming = filterMember ? rawUpcoming.filter(memberFilter) : rawUpcoming
  const displayAllTasks = filterMember ? rawAllTasks.filter(memberFilter) : rawAllTasks
  const myMemberName = access?.member_name || ""
  const myTasks = myMemberName
    ? rawAllTasks.filter((task) => {
      if (Object.values(assignmentForTask(task)).includes(myMemberName)) return true
      return matchMembers(task.responsibility).some((member) => member.name === myMemberName)
    })
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
    canManageAssignments: isSupabaseConfigured,
  }

  const addSheet = async () => {
    const sheet = parseSheetUrl(inputUrl)
    if (!sheet) {
      setSharedError("URL Google Sheet ไม่ถูกต้อง")
      return
    }
    if (sheets.some((current) => current.spreadsheetId === sheet.spreadsheetId)) {
      setSharedError("Google Sheet นี้เชื่อมต่ออยู่แล้ว")
      return
    }
    const saved = await persistShared("sheets", sheet.spreadsheetId, sheet.url)
    if (!saved) return
    setSheets((prev) => [...prev, sheet])
    setInputUrl("")
  }

  const removeSheet = async (spreadsheetId) => {
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
  }, [refreshShared, sheets])

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
    if (sheetListChanged || cacheExpired) syncData()
  }, [sheets, lastSynced, syncData])

  const handleKeyDown = (e) => { if (e.key === "Enter") addSheet() }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-purple-50/60">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm shadow-[0_1px_3px_rgba(147,51,234,0.08)]">
        {/* Row 1: Logo + View tabs + actions */}
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2">
          {/* Left: Logo + Brand */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <img src={magicLogo} alt="MAGIC Digital Marketing Agency" className="h-7 w-7 sm:h-8 sm:w-8 object-contain" />
            <div className="hidden sm:block leading-tight">
              <span className="text-sm font-black tracking-tight text-purple-900">MAGIC</span>
              <span className="text-sm font-light text-purple-400 ml-1">Timeline</span>
            </div>
          </div>

          <div className="h-6 w-px bg-purple-100 shrink-0" />

          {/* Center: View tabs */}
          <div className="flex items-center gap-0.5 rounded-lg bg-purple-50/80 p-0.5 shrink-0">
            {[
              { mode: "my", label: "My Work", icon: "M9 12l2 2 4-4M5 4h14v16H5z" },
              { mode: "table", label: "All Work", icon: "M3 10h18M3 6h18M3 14h18M3 18h18" },
              { mode: "dashboard", label: "Management", icon: "M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-2a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" },
            ].map(({ mode, label, icon }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1 rounded-md px-2 sm:px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  viewMode === mode
                    ? "bg-white text-purple-700 shadow-sm"
                    : "text-purple-400 hover:text-purple-600"
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
              <div className="hidden sm:block h-6 w-px bg-purple-100 shrink-0" />
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
              className="flex items-center gap-1 rounded-lg border border-purple-200/60 bg-purple-50/50 px-2 py-1 text-[10px] font-semibold text-purple-400 transition hover:bg-purple-100 hover:text-purple-600 active:scale-95"
              title={saveStatus["teamMembers:all"] === "saving" ? "กำลังบันทึก..." : "จัดการทีม"}
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="hidden sm:inline">จัดการทีม</span>
            </button>}
            {isAdmin && <button onClick={() => setShowAdminSettings(true)} className="rounded-lg border border-purple-200 px-2 py-1 text-[10px] font-semibold text-purple-600 hover:bg-purple-50">Admin</button>}
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
                Retry
              </button>
            )}
            <button onClick={() => setSharedError(null)} className="text-xs text-amber-500 hover:text-amber-700">✕</button>
          </div>
        )}

        {/* Team Manager Modal */}
        {isAdmin && <TeamManager
          members={teamMembers}
          onUpdate={updateTeamMembers}
          open={showTeamManager}
          onClose={() => setShowTeamManager(false)}
        />}
        <AdminSettings open={showAdminSettings} onClose={() => setShowAdminSettings(false)} currentEmail={user?.email} members={teamMembers} configured={isSupabaseConfigured} />

        {lastSynced && now - lastSynced.getTime() > 24 * 60 * 60 * 1000 && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            ข้อมูลเก่ากว่า 24 ชั่วโมง — ข้อมูล ณ {lastSynced.toLocaleString("th-TH")}
          </div>
        )}

        <div key={viewMode} className="animate-magic-view">
        {viewMode === "my" ? (
          <MyWorkView tasks={myTasks} memberName={myMemberName} workflow={workflow} preferenceOwner={user?.email || "local"} tableProps={{ ...tableProps, clientStats: displayClientStats }} />
        ) : viewMode === "table" ? (
          <>
            {/* ── Overdue Tasks ───────────────────────────────────────────────── */}
            <TaskTable
              title="Overdue Tasks"
              badge="bg-red-400"
              tasks={displayOverdue}
              isLoading={isSyncing}
              {...tableProps}
            />

            {/* ── Upcoming Deadlines ──────────────────────────────────────────── */}
            <TaskTable
              title="Upcoming Deadlines"
              badge="bg-purple-400"
              tasks={displayUpcoming}
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
              canManageAssignments
            />
          </>
        ) : (
          /* ── Dashboard View ───────────────────────────────────────────────── */
          <Suspense fallback={<div className="rounded-2xl border border-purple-100 bg-white p-10 text-center text-sm text-purple-400">Loading management overview…</div>}><DashboardView
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
            preferenceOwner={user?.email || "local"}
          /></Suspense>
        )}
        </div>

        {/* ── Connected Data Sources (bottom) ─────────────────────────────────── */}
        <div className="mt-4 rounded-2xl border border-purple-100 bg-white p-6 shadow-sm">

          {/* Card Header */}
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-purple-900">
                Connected Data Sources
              </h2>
              <p className="mt-0.5 text-xs text-purple-300">
                Google Sheets source of truth {isAdmin ? "— Admin can add or remove sources" : "— managed by Admin"}
              </p>
              {sheets.length > 0 && (
                <button
                  onClick={copyShareLink}
                  className="mt-2 flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-600 transition hover:bg-purple-100 active:scale-95"
                >
                  {copied ? (
                    <><svg className="h-3.5 w-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg><span className="text-green-600">Copied!</span></>
                  ) : (
                    <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>Copy share link</>
                  )}
                </button>
              )}
            </div>

            {/* Sync Button */}
            <div className="flex shrink-0 flex-col items-end gap-1">
              <button
                onClick={() => syncData(true)}
                disabled={isSyncing || sheets.length === 0}
                title={sheets.length === 0 ? "Add at least one sheet to sync" : "Sync all sheets"}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all
                  ${isSyncing
                    ? "cursor-not-allowed bg-purple-400"
                    : sheets.length === 0
                      ? "cursor-not-allowed bg-gray-200 text-gray-400"
                      : "bg-purple-600 hover:bg-purple-700 active:scale-95"
                  }`}
              >
                {isSyncing ? (
                  <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />Syncing…</>
                ) : (
                  <><IconSync className="h-4 w-4" />Sync Data</>
                )}
              </button>
              {lastSynced && !isSyncing && (
                <span className="text-xs text-purple-300">
                  Last synced: {lastSynced.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
          </div>

          {/* Error Banner */}
          {syncError && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <IconWarning className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div>
                <p className="text-sm font-medium text-red-700">Sync failed</p>
                <p className="mt-0.5 text-xs text-red-500">{syncError}</p>
              </div>
              <button onClick={() => setSyncError(null)} className="ml-auto shrink-0 text-xs text-red-400 hover:text-red-600">✕</button>
            </div>
          )}

          {/* URL Input */}
          {isAdmin && <div className="flex gap-2">
            <input
              type="url"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="min-w-0 flex-1 rounded-xl border border-purple-100 px-4 py-2.5 text-sm text-gray-700 placeholder-purple-200 outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
            />
            <button
              onClick={addSheet}
              className="shrink-0 rounded-xl bg-purple-800 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-purple-900 active:scale-95"
            >
              Add Sheet
            </button>
          </div>}

          {/* Sheet List */}
          <div className="mt-4">
            {sheets.length === 0 ? (
              <p className="py-4 text-center text-xs text-purple-200">No sheets connected yet</p>
            ) : (
              <ul className="space-y-2">
                {sheets.map((sheet) => (
                  <li key={sheet.spreadsheetId} className="flex items-center justify-between gap-3 rounded-xl border border-purple-100 bg-purple-50/50 px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <IconCheck className="h-4 w-4 shrink-0 text-purple-400" />
                      <span className="truncate text-sm text-gray-600">{sheet.url}</span>
                    </div>
                    {isAdmin && <button
                      onClick={() => removeSheet(sheet.spreadsheetId)}
                      className="ml-2 shrink-0 rounded-lg p-1 text-purple-300 transition-colors hover:bg-red-50 hover:text-red-500"
                      title="Remove"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
      {selectedTaskKey && <TaskPanel
        key={selectedTaskKey}
        taskKey={selectedTaskKey}
        task={selectedTask}
        brandName={selectedTask ? brandNameForTask(selectedTask) : ""}
        note={remarks[selectedTaskKey] || ""}
        priority={priorities[selectedTaskKey] || ""}
        workflow={workflow[selectedTaskKey] || "not_started"}
        saveStatus={saveStatus}
        configured={isSupabaseConfigured}
        onUpdateNote={updateRemark}
        onUpdatePriority={updatePriority}
        onUpdateWorkflow={updateWorkflow}
        onToggleDone={toggleTask}
        onRefresh={refreshShared}
        onClose={() => setSelectedTaskKey(null)}
      />}
    </div>
  )
}
