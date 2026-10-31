import { blockedRead, READ_INTERVAL } from "../lib/readPolicy"
// Frozen compatibility controller copied from App.jsx; original remains unchanged.
import React, { Suspense, lazy, useState, useEffect, useRef, useCallback } from "react"
import { WarningIcon as PhosphorWarningIcon } from "@phosphor-icons/react/dist/csr/Warning"
import TaskTable, { CompletedClients } from "../components/TimelineTable"
import { categorizeTasks, extractBrandName } from "../lib/sheetsApi"
import { applyMemberAvatar, mergeRemoteTeamMembers, mergeSavedTeamMember, taskOwnerNames } from "../lib/teamConfig"
import { cachePendingWrites, cacheSharedState, loadCachedSharedState, loadPendingWrites, mergeRemote, mergeRemoteProjects, normalizeBrandKey, overlayPendingProjects, parseSheetUrl, sheetsFromLegacyHash, tabKey, taskKey as sharedTaskKey } from "./legacySharedState"
import { assignTabsToBrand, deleteTeamAvatar, fetchSystemAnalytics, fetchSystemState, patchSystemState, renameSystemBrand, saveAccess, saveBrandCatalog, saveBrandContract, saveBrandProject, saveMilestoneOverride, saveTeamAvatar, setBrandCatalogActive, setBrandContractRenewalStatus, setBrandContractStatus, setBrandProjectActive, systemSyncStatus, triggerSystemSync, updateSystemCompletion, uploadTeamAvatar } from "../lib/fullSystem"
import { isSupabaseConfigured } from "../lib/supabase"
import { persistAvatarChange } from "../lib/teamAvatar"
import { assignmentKeyForTask as resolveAssignmentKey, resolveAssignment } from "../lib/assignmentResolver"
import MyWorkView from "../components/MyWorkView"
import Emoji from "../components/Emoji"
import { Banner, Button, ViewSkeleton } from "../components/ui"
import TeamFilterBar from "../components/TeamFilterBar"
import NotificationCenter from "./NotificationCenter"
import { useAuth } from "../lib/auth"
import { bangkokDate } from "../lib/dates"
import magicLogo from "../assets/magic-logo.svg"

const DashboardView = lazy(() => import("../components/DashboardView"))
const BrandView = lazy(() => import("../components/BrandProjectsView"))
const AppHeader = lazy(() => import("./AppHeader"))
const TaskPanel = lazy(() => import("../components/TaskPanel"))
const TeamManager = lazy(() => import("../components/TeamManager"))
const AdminSettings = lazy(() => import("../components/AdminSettings"))
const FollowUpView = lazy(() => import("../components/FollowUpView"))
const ManualNotificationComposer = lazy(() => import("../components/ManualNotificationComposer"))

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
  return <PhosphorWarningIcon aria-hidden="true" className={className} weight="duotone" />
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function LegacyApp({ initialView = "my", initialContractId = null, refreshToken = 0, readSnapshot = fetchSystemState, refreshResource }) {
  const { access, user, signOut } = useAuth()
  const isAdmin = access?.role === "admin" && isSupabaseConfigured
  const canManageAssignments = isSupabaseConfigured
  const [cachedShared] = useState(loadCachedSharedState)
  const [initialPendingWrites] = useState(loadPendingWrites)
  const [now, setNow] = useState(() => Date.now())
  const [sheets, setSheets] = useState(() => {
    let base = cachedShared?.sheets
    if (!base) try { base = JSON.parse(sessionValue("magic-v2-sheets", "[]")).map((s) => parseSheetUrl(s.url)).filter(Boolean) }
    catch { base = [] }
    return overlayPendingSheets(base, initialPendingWrites)
  })
  const [inputUrl, setInputUrl]     = useState("")
  const [isSyncing, setIsSyncing]   = useState(false)
  // Restore cached live data so the page shows real data immediately on reload
  const [liveTasks, setLiveTasks]   = useState(() => {
    try {
      const cached = JSON.parse(sessionValue("magic-v2-live-task-rows", sessionValue("magic-v2-live-tasks", "null")))
      return cached ? categorizeTasks(Array.isArray(cached) ? cached : cached.allTasks || []) : null
    }
    catch { return null }
  })
  const [syncError, setSyncError]   = useState(null)
  const [lastSynced, setLastSynced] = useState(() => {
    const ts = sessionValue("magic-v2-last-synced")
    return ts ? new Date(ts) : null
  })
  const [viewMode, setViewMode] = useState(() => {
    const saved = localStorage.getItem(`magic-v2-view:${user?.email || "legacy"}`)
    return initialView || saved || (access?.role === "employee" ? "my" : "dashboard")
  })
  const tableFilterKey = `magic-v2-table-member:${user?.email || "legacy"}`
  const [filterMember, setFilterMember] = useState(() => localStorage.getItem(tableFilterKey) || null)
  const [showTeamManager, setShowTeamManager] = useState(false)
  const [showAdminSettings, setShowAdminSettings] = useState(false)
  const [teamMembers, setTeamMembers] = useState(() => {
    const pending = initialPendingWrites.find((item) => item.resource === "teamMembers")?.value
    return Array.isArray(pending) ? pending : Array.isArray(cachedShared?.teamMembers) ? cachedShared.teamMembers : []
  })
  const [sharedError, setSharedError] = useState(() => initialPendingWrites.length ? "มีข้อมูลที่ยังบันทึกไม่สำเร็จ กด Retry เพื่อส่งเข้าระบบกลาง" : null)
  const [saveStatus, setSaveStatus] = useState(() => Object.fromEntries(initialPendingWrites.map(({ resource, key }) => [`${resource}:${key}`, "failed"])))
  const [brands, setBrands] = useState(() => overlayPendingRecords(cachedShared?.brands, initialPendingWrites, "brands"))
  const [brandCatalog, setBrandCatalog] = useState(() => cachedShared?.brandCatalog || [])
  const [workflow, setWorkflow] = useState(() => overlayPendingRecords(cachedShared?.workflow, initialPendingWrites, "workflow"))
  const [nextActions, setNextActions] = useState(() => overlayPendingRecords(cachedShared?.nextActions, initialPendingWrites, "nextActions"))
  const [noteVersions, setNoteVersions] = useState(() => cachedShared?.noteVersions || {})
  const [noteConflicts, setNoteConflicts] = useState({})
  const [brandProjects, setBrandProjects] = useState(() => overlayPendingProjects(cachedShared?.brandProjects || [], initialPendingWrites))
  const [brandContracts, setBrandContracts] = useState(() => cachedShared?.brandContracts || [])
  const [milestoneOverrides, setMilestoneOverrides] = useState(() => cachedShared?.milestoneOverrides || {})
  const [dailyMetrics, setDailyMetrics] = useState([])
  const [taskEvents, setTaskEvents] = useState([])
  const [syncStatus, setSyncStatus] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [lastScreenRefreshedAt, setLastScreenRefreshedAt] = useState(null)
  const [selectedTaskKey, setSelectedTaskKey] = useState(null)
  const [brandNavigationTarget, setBrandNavigationTarget] = useState(initialContractId)
  const [manualNotificationTaskKey, setManualNotificationTaskKey] = useState(null)
  const [manualNotificationOpen, setManualNotificationOpen] = useState(false)
  const syncingRef = useRef(false)
  const refreshVersionRef = useRef(0)
  const completionLocksRef = useRef(new Set())
  const dirtyRef = useRef(new Set(initialPendingWrites.map(({ resource, key }) => `${resource}:${key}`)))
  const pendingWritesRef = useRef(new Map(initialPendingWrites.map((item) => [`${item.resource}:${item.key}`, item])))
  const writeVersionsRef = useRef(new Map())
  const writeChainsRef = useRef(new Map())
  const addSheetInFlightRef = useRef(false)
  const teamMembersRef = useRef(teamMembers)

  useEffect(() => {
    teamMembersRef.current = teamMembers
  }, [teamMembers])

  const refreshAnalytics = useCallback(async () => {
    if (!isSupabaseConfigured || !["dashboard", "admin"].includes(viewMode)) return {dailyMetrics:[],taskEvents:[]}
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
    if (!base) try { base = JSON.parse(sessionValue("magic-v2-remarks", "{}")) }
    catch { base = {} }
    return overlayPendingRecords(base, initialPendingWrites, "remarks")
  })
  const [priorities, setPriorities] = useState(() => {
    let base = cachedShared?.priorities
    if (!base) try { base = JSON.parse(sessionValue("magic-v2-priorities", "{}")) }
    catch { base = {} }
    return overlayPendingRecords(base, initialPendingWrites, "priorities")
  })
  const [assignments, setAssignments] = useState(() => {
    let base = cachedShared?.assignments
    if (!base) try { base = JSON.parse(sessionValue("magic-v2-assignments", "{}")) }
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
      window.dispatchEvent(new Event("timeline:activity"))
      let confirmationError = null
      try { await refreshResource?.(resource, key) } catch (error) { confirmationError = error }
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
        if (confirmationError) setSharedError(`บันทึกสำเร็จ แต่อ่านข้อมูลล่าสุดไม่สำเร็จ: ${confirmationError.message} — กด Refresh เพื่อตรวจอีกครั้ง`)
        else if (result?.warning) setSharedError(`บันทึกสำเร็จ แต่ ${result.warning}`)
        else if (pendingWritesRef.current.size === 0) setSharedError(null)
      }
      return true
    } catch (error) {
      if (writeVersionsRef.current.get(dirtyKey) === version) {
        if (options.discardOnFailure) {
          dirtyRef.current.delete(dirtyKey)
          pendingWritesRef.current.delete(dirtyKey)
          cachePendingWrites([...pendingWritesRef.current.values()])
        }
        setSaveStatus((prev) => ({ ...prev, [dirtyKey]: "failed" }))
        if (resource === "remarks" && error.status === 409 && Number.isInteger(error.data?.noteVersion)) {
          setNoteConflicts((current) => ({ ...current, [key]: error.data }))
          setRemarks((current) => error.data.currentNote ? { ...current, [key]: error.data.currentNote } : Object.fromEntries(Object.entries(current).filter(([recordKey]) => recordKey !== key)))
          setNoteVersions((current) => ({ ...current, [key]: error.data.noteVersion || 0 }))
          setSharedError("Note มีการแก้ไขจากอีกหน้าจอ กรุณาเลือกโหลดค่าล่าสุดหรือบันทึกทับ")
        } else if (options.discardOnFailure) setSharedError(`${error.message} — ยังไม่ได้เปลี่ยนข้อมูล`)
        else setSharedError(`${error.message} — ข้อมูลยังอยู่ในเครื่อง กด Retry เพื่อบันทึกอีกครั้ง`)
      }
      return false
    } finally {
      if (writeChainsRef.current.get(dirtyKey) === request) writeChainsRef.current.delete(dirtyKey)
    }
  }, [refreshResource])

  const retryPendingWrites = useCallback(() => {
    const pending = [...pendingWritesRef.current.values()]
    return Promise.all(pending.map(({ resource, key, value, mutation, options }) => persistShared(resource, key, value, mutation, options)))
  }, [persistShared])

  useEffect(() => {
    if (refreshToken) void refreshShared(false);
    // Explicit V2 toolbar refresh only; preserve legacy refresh behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const readStatus = useRef({at:0,error:null})
  const refreshShared = useCallback(async (force = true) => {
    const requestVersion = ++refreshVersionRef.current
    try {
      const remote = await readSnapshot(force === true)
      readStatus.current = {at:Date.now(),error:null}
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
      if (Array.isArray(remote.teamMembers)) {
        setTeamMembers((local) => {
          const dirtyKey = "teamMembers:all"
          const hasPendingChanges = dirtyRef.current.has(dirtyKey)
          const merged = mergeRemoteTeamMembers(local, remote.teamMembers, hasPendingChanges)
          teamMembersRef.current = merged
          if (hasPendingChanges) {
            const pending = pendingWritesRef.current.get(dirtyKey)
            if (pending) {
              pendingWritesRef.current.set(dirtyKey, { ...pending, value: merged, mutation: merged })
              cachePendingWrites([...pendingWritesRef.current.values()])
            }
          }
          return merged
        })
      }
      setBrands((local) => mergeRemote(local, remote.brands, dirtyRef.current, "brands"))
      setBrandCatalog(remote.brandCatalog || [])
      setAssignments((local) => mergeRemote(local, remote.assignments, dirtyRef.current, "assignments"))
      setRemarks((local) => mergeRemote(local, remote.remarks, dirtyRef.current, "remarks"))
      setPriorities((local) => mergeRemote(local, remote.priorities, dirtyRef.current, "priorities"))
      setWorkflow((local) => mergeRemote(local, remote.workflow, dirtyRef.current, "workflow"))
      setNextActions((local) => mergeRemote(local, remote.nextActions, dirtyRef.current, "nextActions"))
      setNoteVersions(remote.noteVersions || {})
      setSyncStatus(remote.syncStatus || null)
      setBrandProjects((local) => mergeRemoteProjects(local, remote.brandProjects || [], pendingWritesRef.current))
      setBrandContracts(remote.brandContracts || [])
      setMilestoneOverrides(remote.milestoneOverrides || {})
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
      readStatus.current = {at:Date.now(),error}
      setSharedError(`${error.message} — กำลังใช้ข้อมูล cache ในเครื่อง`)
      return null
    }
  }, [readSnapshot])

  useEffect(() => {
    if (!isSupabaseConfigured || (!selectedTaskKey && !['my', 'follow_up'].includes(viewMode))) return
    const refreshVisible = (timerTick = false) => { if (document.visibilityState !== 'hidden' && !blockedRead(readStatus.current.error) && (timerTick === true || Date.now()-readStatus.current.at >= READ_INTERVAL)) void refreshShared(timerTick === true) }
    const timer = setInterval(() => refreshVisible(true), READ_INTERVAL)
    document.addEventListener("visibilitychange", refreshVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", refreshVisible)
    }
  }, [refreshShared, selectedTaskKey, viewMode])

  useEffect(() => {
    let active = true
    setIsRefreshing(true)
    Promise.all([refreshShared(false), refreshAnalytics()]).then(([shared, analytics]) => {
      if (!active) return
      const failed = isSupabaseConfigured && (!shared || !analytics)
      setRefreshFailed(failed)
      if (!failed) setLastScreenRefreshedAt(new Date())
    }).finally(() => {
      if (active) setIsRefreshing(false)
    })
    return () => { active = false }
  }, [refreshAnalytics, refreshShared])

  const refreshScreen = useCallback(async () => {
    if (isRefreshing) return false
    setIsRefreshing(true)
    try {
      const [shared, analytics] = await Promise.all([refreshShared(), refreshAnalytics()])
      const saved = !isSupabaseConfigured || Boolean(shared && analytics)
      setRefreshFailed(!saved)
      if (saved) setLastScreenRefreshedAt(new Date())
      return saved
    } finally {
      setIsRefreshing(false)
    }
  }, [isRefreshing, refreshAnalytics, refreshShared])

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
    localStorage.setItem(`magic-v2-view:${user?.email || "legacy"}`, viewMode)
  }, [user?.email, viewMode])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedView = params.get("view")
    if (["my", "table", "brand", "dashboard"].includes(requestedView) || (requestedView === "follow_up" && isAdmin)) setViewMode(requestedView)
    const requestedTask = params.get("task")
    if (requestedTask) setSelectedTaskKey(requestedTask)
  }, [isAdmin])

  useEffect(() => {
    if (filterMember) localStorage.setItem(tableFilterKey, filterMember)
    else localStorage.removeItem(tableFilterKey)
  }, [filterMember, tableFilterKey])

  const updateTeamMembers = (newMembers) => {
    teamMembersRef.current = newMembers
    setTeamMembers(newMembers)
    return persistShared("teamMembers", "all", newMembers)
  }

  const addTeamMemberWithAccess = async ({ email, name, teamRole }) => {
    try {
      const hadPendingTeamWrite = dirtyRef.current.has("teamMembers:all")
      const saved = await saveAccess({
        email: email.trim().toLowerCase(),
        role: "employee",
        member_name: name.trim(),
        team_role: teamRole,
        active: true,
      })
      const mergedMembers = mergeSavedTeamMember(teamMembersRef.current, saved?.member || { name, role: teamRole })
      teamMembersRef.current = mergedMembers
      setTeamMembers(mergedMembers)
      if (hadPendingTeamWrite || dirtyRef.current.has("teamMembers:all")) {
        await persistShared("teamMembers", "all", mergedMembers)
      }
      await refreshShared()
      return true
    } catch (error) {
      setSharedError(error.message)
      throw error
    }
  }

  const updateTeamAvatar = async (memberName, blob) => {
    try {
      const result = await persistAvatarChange({
        members: teamMembersRef.current,
        memberName,
        blob,
        upload: uploadTeamAvatar,
        persist: async (name, avatar) => Boolean(await saveTeamAvatar(name, avatar)),
        remove: deleteTeamAvatar,
      })
      if (result.saved) {
        const nextMembers = applyMemberAvatar(teamMembersRef.current, result.memberName, result.avatar)
        teamMembersRef.current = nextMembers
        setTeamMembers(nextMembers)
      }
      return result.saved
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }

  const removeTeamAvatar = async (memberName) => {
    const previous = teamMembersRef.current.find((member) => member.name.trim().toLocaleLowerCase("th-TH") === memberName.trim().toLocaleLowerCase("th-TH"))?.avatar
    try {
      await saveTeamAvatar(memberName, "")
      const nextMembers = applyMemberAvatar(teamMembersRef.current, memberName, "")
      teamMembersRef.current = nextMembers
      setTeamMembers(nextMembers)
      if (previous) deleteTeamAvatar(previous).catch(() => {})
      return true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
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
  const updateWorkflow = useCallback((key, value, nextAction) => {
    if (nextAction !== undefined) setNextActions((current) => nextAction ? { ...current, [key]: nextAction } : Object.fromEntries(Object.entries(current).filter(([recordKey]) => recordKey !== key)))
    if (!isSupabaseConfigured) return updateRecord("workflow", setWorkflow, key, value)
    setWorkflow((current) => ({ ...current, [key]: value }))
    return persistShared("workflow", key, value, value, { nextAction })
  }, [persistShared, updateRecord])
  const updateNextAction = useCallback((key, value) => updateRecord("nextActions", setNextActions, key, value), [updateRecord])
  const updateBrand = useCallback((key, value) => updateRecord("brands", setBrands, key, value), [updateRecord])
  const refreshStructure = useCallback(async () => {
    await refreshResource?.('structure');
    return refreshShared(false);
  }, [refreshResource,refreshShared])
  const renameBrand = useCallback(async (oldName, newName, tabs) => {
    try {
      await renameSystemBrand(oldName, newName, tabs.map((tab) => tab.key))
      await refreshStructure()
      return true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }, [refreshStructure])

  const saveBrandProjectRecord = useCallback(async (payload) => {
    try {
      await saveBrandProject(payload)
      await refreshStructure()
      return true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }, [refreshStructure])

  const saveBrandCatalogRecord = useCallback(async (payload) => {
    try {
      const id = await saveBrandCatalog(payload)
      await refreshStructure()
      return id || true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }, [refreshStructure])

  const assignTabsToBrandRecord = useCallback(async (brandId, tabKeys) => {
    try {
      await assignTabsToBrand(brandId, tabKeys)
      await refreshStructure()
      return true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }, [refreshStructure])

  const setBrandCatalogActiveRecord = useCallback(async (id, active) => {
    try {
      await setBrandCatalogActive(id, active)
      await refreshStructure()
      return true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }, [refreshStructure])

  const setBrandProjectActiveRecord = useCallback(async (id, active) => {
    try {
      await setBrandProjectActive(id, active)
      await refreshStructure()
      return true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }, [refreshStructure])

  const saveBrandContractRecord = useCallback(async (payload) => {
    try {
      await saveBrandContract(payload)
      await refreshStructure()
      return true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }, [refreshStructure])

  const setBrandContractStatusRecord = useCallback(async (id, status) => {
    try {
      await setBrandContractStatus(id, status)
      await refreshStructure()
      return true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }, [refreshStructure])

  const setBrandContractRenewalStatusRecord = useCallback(async (id, status) => {
    try {
      await setBrandContractRenewalStatus(id, status)
      await refreshStructure()
      return true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }, [refreshStructure])

  const saveMilestoneOverrideRecord = useCallback(async (key, value) => {
    try {
      await saveMilestoneOverride(key, value)
      try { await refreshResource?.("structure") } catch (error) { setSharedError(`บันทึกสำเร็จ แต่อ่านข้อมูลล่าสุดไม่สำเร็จ: ${error.message}`) }
      setMilestoneOverrides((current) => {
        const next = { ...current }
        if (value === "auto") delete next[key]
        else next[key] = value
        return next
      })
      return true
    } catch (error) {
      setSharedError(error.message)
      return false
    }
  }, [refreshResource])
  const seededBrandsRef = useRef(false)

  useEffect(() => {
    if (seededBrandsRef.current || !liveTasks?.allTasks?.length || Object.keys(brands).length > 0) return
    seededBrandsRef.current = true
    try {
      const local = JSON.parse(localStorage.getItem("magic-v2-brand-names") || "null")
      Object.entries(local?.confirmedBrands || {}).forEach(([brandName, data]) => {
        liveTasks.allTasks
          .filter((task) => data.tabs?.includes(task.clientName))
          .forEach((task) => updateBrand(tabKey(task), brandName))
      })
      localStorage.removeItem("magic-v2-brand-names")
    } catch { /* legacy brand cache is optional */ }
  }, [brands, liveTasks, updateBrand])

  const brandNameForTask = useCallback((task) => brands[tabKey(task)] || extractBrandName(task.clientName), [brands])
  const projectAssignments = React.useMemo(
    () => Object.fromEntries(brandProjects.filter((project) => project.active !== false).map((project) => [project.id, project.assignment || {}])),
    [brandProjects],
  )
  const assignmentKeyForTask = useCallback((task) => resolveAssignmentKey(task, brandProjects, brandNameForTask(task)), [brandNameForTask, brandProjects])
  const visibleAssignments = React.useMemo(() => ({ ...assignments, ...projectAssignments }), [assignments, projectAssignments])
  const assignmentForTask = useCallback((task) => resolveAssignment(task, { projects: brandProjects, projectAssignments, assignments, brandName: brandNameForTask(task) }), [assignments, brandNameForTask, brandProjects, projectAssignments])
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
      sessionStorage.setItem("magic-v2-live-task-rows", JSON.stringify(liveTasks.allTasks))
      sessionStorage.removeItem("magic-v2-live-tasks")
    } catch { /* cache is optional */ }
  }, [liveTasks])
  useEffect(() => {
    if (lastSynced) try { sessionStorage.setItem("magic-v2-last-synced", lastSynced.toISOString()) }
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

  const contractEndByBrand = brandCatalog.reduce((map, brand) => {
    const contract = brandContracts
      .filter((item) => item.brandId === brand.id && item.status === "open")
      .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)))[0]
    if (contract) map[normalizeBrandKey(brand.name)] = { endDate: contract.endDate, contractId: contract.id }
    return map
  }, {})

  const updateProjectAssignment = useCallback((assignmentKey, value, mutation) => {
    const projectId = assignmentKey
    const project = brandProjects.find((item) => item.id === projectId)
    if (project) {
      setBrandProjects((current) => current.map((item) => item.id === projectId ? { ...item, assignment: value } : item))
      return persistShared("projectAssignments", projectId, value).then(async (saved) => {
        if (saved) await refreshShared(false)
        return saved
      })
    }
    const legacyKey = normalizeBrandKey(assignmentKey)
    setAssignments((current) => ({ ...current, [legacyKey]: value }))
    return persistShared("assignments", legacyKey, value, mutation || { clear: !Object.keys(value || {}).length })
  }, [brandProjects, persistShared, refreshShared])

  const tableProps = {
    clientStats: displayClientStats,
    remarks,
    onUpdateRemark: updateRemark,
    priorities,
    onUpdatePriority: updatePriority,
    assignments: visibleAssignments,
    teamMembers,
    onUpdateAssignment: updateProjectAssignment,
    brandNameForTask,
    assignmentKeyForTask,
    saveStatus,
    onToggle: toggleTask,
    onOpenTask: openTask,
    workflow,
    onUpdateWorkflow: updateWorkflow,
    canManageAssignments,
    canEditTask,
    contractEndByBrand,
    milestoneOverrides,
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
          try { sessionStorage.setItem("magic-v2-sheets", JSON.stringify(next)) } catch { /* local preview cache is optional */ }
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
        try { sessionStorage.setItem("magic-v2-sheets", JSON.stringify(next)) } catch { /* local preview cache is optional */ }
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

  return (
    <div className="min-h-screen bg-[var(--ui-canvas)] text-[var(--ui-text)]">

      <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหาหลัก</a>
      <Suspense fallback={<div className="h-16 border-b border-[var(--ui-border)] bg-white" aria-hidden="true" />}>
        <AppHeader
          viewMode={viewMode}
          onViewChange={setViewMode}
          filterMember={filterMember}
          onFilterMemberChange={setFilterMember}
          teamMembers={teamMembers}
          isAdmin={isAdmin}
          role={access?.role}
          configured={isSupabaseConfigured}
          email={user?.email}
          isRefreshing={isRefreshing}
          lastRefreshedAt={lastScreenRefreshedAt}
          onRefresh={refreshScreen}
          onOpenTask={openTask}
          onOpenContract={(contractId) => { setViewMode("brand"); setBrandNavigationTarget(contractId) }}
          onOpenTeam={() => setShowTeamManager(true)}
          onOpenAdmin={() => setShowAdminSettings(true)}
          onOpenManual={() => { setManualNotificationTaskKey(null); setManualNotificationOpen(true) }}
          onSignOut={signOut}
        />
      </Suspense>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      {viewMode === "__legacy" && <header className="hidden" aria-hidden="true">
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
          <div className="ui-nav-tabs flex items-center gap-0.5 rounded-lg p-0.5 shrink-0">
            {[
              { mode: "my", label: "My Work", icon: "M9 12l2 2 4-4M5 4h14v16H5z" },
              { mode: "table", label: "Explorer", icon: "M3 10h18M3 6h18M3 14h18M3 18h18" },
              { mode: "dashboard", label: "Timeline", icon: "M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-2a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" },
            ].map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                aria-label={label}
                aria-current={viewMode === mode ? "page" : undefined}
                data-active={viewMode === mode}
                className={`ui-nav-tab flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold sm:min-h-0 sm:min-w-0 sm:px-2.5 ${
                  viewMode === mode
                    ? "bg-[var(--ui-brand-soft)] text-[var(--ui-brand)]"
                    : "text-[var(--ui-muted)] hover:bg-white hover:text-[var(--ui-text)]"
                }`}
              >
                <Emoji name={mode === "my" ? "myWork" : mode === "table" ? "list" : "dashboard"} />
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
              <Emoji name="admin" />
              <span className="hidden sm:inline">จัดการทีม</span>
            </button>}
            <button onClick={() => setShowAdminSettings(true)} className="ui-button ui-button-secondary min-h-11 px-2 text-[10px] font-semibold sm:min-h-0"><Emoji name={isAdmin ? "admin" : "add"} /> {isAdmin ? "Admin" : "Add Sheet"}</button>
            <NotificationCenter configured={isSupabaseConfigured} email={user?.email} onOpenTask={openTask} />
            {isSupabaseConfigured && <button onClick={signOut} className="ui-button ui-button-secondary min-h-0 px-2 py-1 text-[10px]" title={user?.email}>Sign out</button>}
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
      </header>}

      <main id="main-content" className="ui-app-main mx-auto max-w-screen-2xl p-3 sm:p-8">

        {sharedError && (
          <Banner tone="warning" className="mb-4" icon={<IconWarning className="h-5 w-5" />} actions={<>{refreshFailed && <Button onClick={refreshScreen} disabled={isRefreshing} variant="secondary" size="sm"><Emoji name="retry" /> Retry refresh</Button>}{Object.values(saveStatus).includes("failed") && <Button onClick={retryPendingWrites} variant="secondary" size="sm"><Emoji name="retry" /> Retry save</Button>}<button onClick={() => setSharedError(null)} aria-label="ปิดข้อความแจ้งเตือน" className="ui-icon-button text-amber-600">✕</button></>}>
            <p className="text-xs text-amber-700">{sharedError}</p>
          </Banner>
        )}

        {/* Team Manager Modal */}
        <Suspense fallback={null}>{isAdmin && <TeamManager
          members={teamMembers}
          onUpdate={updateTeamMembers}
          onAddMember={addTeamMemberWithAccess}
          onUploadAvatar={updateTeamAvatar}
          onRemoveAvatar={removeTeamAvatar}
          open={showTeamManager}
          onClose={() => setShowTeamManager(false)}
        />}
        <AdminSettings
          open={showAdminSettings}
          onClose={() => setShowAdminSettings(false)}
          currentEmail={user?.email}
          members={teamMembers}
          configured={isSupabaseConfigured}
          isAdmin={isAdmin}
          onSaved={refreshShared}
          dataSources={{ sheets, inputUrl, setInputUrl, addSheet, removeSheet, syncData, isSyncing, lastSynced, syncError }}
        />
        </Suspense>

        {lastSynced && now - lastSynced.getTime() > 24 * 60 * 60 * 1000 && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <Emoji name="warning" /> ข้อมูลเก่ากว่า 24 ชั่วโมง — ข้อมูล ณ {lastSynced.toLocaleString("th-TH")}
          </div>
        )}

        <div key={viewMode} className="ui-view-enter">
        {viewMode === "my" ? (
          <MyWorkView tasks={myTasks} memberName={myMemberName} workflow={workflow} preferenceOwner={`v2:${user?.email || "local"}`} tableProps={{ ...tableProps, clientStats: displayClientStats }} />
        ) : viewMode === "follow_up" && isAdmin ? (
          <Suspense fallback={<ViewSkeleton label="กำลังโหลด Follow-up" />}><FollowUpView onOpenTask={openTask} onManualNotification={(key) => { setManualNotificationTaskKey(key); setManualNotificationOpen(true) }} /></Suspense>
        ) : viewMode === "brand" ? (
          <Suspense fallback={<ViewSkeleton label="กำลังโหลด Brand overview" />}>
            <BrandView
              allTasks={rawAllTasks}
              assignments={visibleAssignments}
              teamMembers={teamMembers}
              brands={brands}
              brandCatalog={brandCatalog}
              brandNameForTask={brandNameForTask}
              assignmentKeyForTask={assignmentKeyForTask}
              workflow={workflow}
              milestoneOverrides={milestoneOverrides}
              projects={brandProjects}
              contracts={brandContracts}
              tableProps={{ ...tableProps, clientStats: displayClientStats }}
              canAdmin={isAdmin}
              focusContractId={brandNavigationTarget}
              onOpenTask={openTask}
              onSaveProject={saveBrandProjectRecord}
              onSaveBrand={saveBrandCatalogRecord}
              onAssignTabsToBrand={assignTabsToBrandRecord}
              onSetBrandActive={setBrandCatalogActiveRecord}
              onSetProjectActive={setBrandProjectActiveRecord}
              onSaveContract={saveBrandContractRecord}
              onSetContractStatus={setBrandContractStatusRecord}
              onSetContractRenewalStatus={setBrandContractRenewalStatusRecord}
              onSaveMilestoneOverride={saveMilestoneOverrideRecord}
            />
          </Suspense>
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
              assignments={visibleAssignments}
              teamMembers={teamMembers}
              onUpdateAssignment={updateProjectAssignment}
              brandNameForTask={brandNameForTask}
              assignmentKeyForTask={assignmentKeyForTask}
              canManageAssignments={canManageAssignments}
            />
          </>
        ) : (
          /* ── Dashboard View ───────────────────────────────────────────────── */
          <Suspense fallback={<ViewSkeleton label="กำลังโหลด Timeline overview" />}><DashboardView
            allTasks={rawAllTasks}
            assignments={visibleAssignments}
            onUpdateAssignment={updateProjectAssignment}
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
            contractEnds={contractEndByBrand}
            milestoneOverrides={milestoneOverrides}
            lastSynced={lastSynced}
            canAdmin={isAdmin}
            canManageAssignments={canManageAssignments}
            preferenceOwner={`v2:${user?.email || "local"}`}
            onOpenTask={openTask}
            onManageBrands={() => setViewMode("brand")}
          /></Suspense>
        )}
        </div>

      </main>
      <Suspense fallback={null}>{selectedTaskKey && <TaskPanel
        key={selectedTaskKey}
        taskKey={selectedTaskKey}
        task={selectedTask}
        brandName={selectedTask ? brandNameForTask(selectedTask) : ""}
        note={remarks[selectedTaskKey] || ""}
        noteVersion={noteVersions[selectedTaskKey] || 0}
        noteConflict={noteConflicts[selectedTaskKey] || null}
        priority={priorities[selectedTaskKey] || ""}
        workflow={workflow[selectedTaskKey] || "not_started"}
        nextAction={nextActions[selectedTaskKey] || ""}
        milestoneOverrides={milestoneOverrides}
        saveStatus={saveStatus}
        configured={isSupabaseConfigured}
        editable={selectedTask ? canEditTask(selectedTask) : false}
        onUpdateNote={updateRemark}
        onDiscardNoteConflict={discardRemarkConflict}
        onUpdatePriority={updatePriority}
        onUpdateWorkflow={updateWorkflow}
        onUpdateNextAction={updateNextAction}
        canManualNotify={isAdmin}
        onManualNotify={() => { setManualNotificationTaskKey(selectedTaskKey); setManualNotificationOpen(true) }}
        onToggleDone={toggleTask}
        onRefresh={refreshShared}
        onClose={() => setSelectedTaskKey(null)}
      />}</Suspense>
      <Suspense fallback={null}><ManualNotificationComposer open={manualNotificationOpen} prefillTaskKey={manualNotificationTaskKey || ""} onClose={() => { setManualNotificationOpen(false); setManualNotificationTaskKey(null) }} /></Suspense>
    </div>
  )
}
