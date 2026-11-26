import { app, powerSaveBlocker } from 'electron'
import os from 'os'
import { appendStreamPathLog } from './streamPathFile'

let holders = 0
let suspensionBlocker = -1
let displayBlocker = -1
const elevatedPids = new Set<number>()

export function acquireStreamPerformance() {
    holders++
    if (holders > 1) {
        return
    }

    if (powerSaveBlocker && typeof powerSaveBlocker.start === 'function') {
        suspensionBlocker = powerSaveBlocker.start('prevent-app-suspension')
        displayBlocker = powerSaveBlocker.start('prevent-display-sleep')
        appendStreamPathLog('stream performance mode on: app suspension and display sleep blocked')
    }

    raiseProcessPriority(process.pid, 'main')
    raiseHelperPriorities()
}

export function releaseStreamPerformance() {
    if (holders === 0) {
        return
    }
    holders--
    if (holders > 0) {
        return
    }

    if (powerSaveBlocker && typeof powerSaveBlocker.isStarted === 'function') {
        if (suspensionBlocker !== -1 && powerSaveBlocker.isStarted(suspensionBlocker)) {
            powerSaveBlocker.stop(suspensionBlocker)
        }
        if (displayBlocker !== -1 && powerSaveBlocker.isStarted(displayBlocker)) {
            powerSaveBlocker.stop(displayBlocker)
        }
    }
    suspensionBlocker = -1
    displayBlocker = -1

    restoreProcessPriorities()
    appendStreamPathLog('stream performance mode off')
}

function raiseProcessPriority(pid: number, label: string) {
    try {
        os.setPriority(pid, os.constants.priority.PRIORITY_ABOVE_NORMAL)
        elevatedPids.add(pid)
        appendStreamPathLog(`${label} (pid ${pid}) priority raised to ABOVE_NORMAL`)
    } catch {
        // Ignore if OS denies priority change.
    }
}

function restoreProcessPriorities() {
    for (const pid of elevatedPids) {
        try {
            os.setPriority(pid, os.constants.priority.PRIORITY_NORMAL)
            appendStreamPathLog(`pid ${pid} priority restored to NORMAL`)
        } catch {
            // Process may have exited already.
        }
    }
    elevatedPids.clear()
}

function raiseHelperPriorities() {
    if (!app || typeof app.getAppMetrics !== 'function') {
        return
    }
    try {
        const metrics = app.getAppMetrics()
        for (const metric of metrics) {
            if (metric.pid && metric.pid !== process.pid && (metric.type === 'GPU' || metric.type === 'Tab')) {
                raiseProcessPriority(metric.pid, metric.type.toLowerCase())
            }
        }
    } catch {
        // Ignore if app metrics are unavailable (e.g., unit tests).
    }
}
