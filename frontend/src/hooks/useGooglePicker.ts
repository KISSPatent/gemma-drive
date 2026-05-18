/**
 * UNUSED. Initial implementation of file selection via Google Picker API.
 * Replaced by direct Drive API browsing (see DriveBrowser.tsx) because
 * the Picker required additional GCP project configuration that
 * complicated setup. Kept here for reference.
 *
 * Backend endpoints picker_config and access_token in drive/views.py
 * also exist only to serve this hook and can be removed if this is deleted.
 */

import { useCallback, useEffect, useState } from "react"

declare global {
  interface Window {
    gapi: any
    google: any
  }
}

const GAPI_SRC = "https://apis.google.com/js/api.js"
const GSI_SRC = "https://accounts.google.com/gsi/client"

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement("script")
    s.src = src
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(s)
  })
}

export type PickedFile = {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  sizeBytes?: string
}

export function useGooglePicker() {
  const [ready, setReady] = useState(false)
  const [config, setConfig] = useState<{
    api_key: string
    app_id: string
    client_id: string
  } | null>(null)

  useEffect(() => {
    (async () => {
      await Promise.all([loadScript(GAPI_SRC), loadScript(GSI_SRC)])
      await new Promise<void>((resolve) =>
        window.gapi.load("picker", { callback: () => resolve() })
      )
      const r = await fetch("http://localhost:8000/api/drive/picker-config")
      setConfig(await r.json())
      setReady(true)
    })().catch(console.error)
  }, [])

  const openPicker = useCallback(
    async (onPicked: (files: PickedFile[]) => void) => {
      if (!ready || !config) throw new Error("Picker not ready")

      const tokenRes = await fetch("http://localhost:8000/api/auth/google/token")
      const { access_token } = await tokenRes.json()

      const docsView = new window.google.picker.DocsView()
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false)
        .setMode(window.google.picker.DocsViewMode.LIST)

      const picker = new window.google.picker.PickerBuilder()
        .setOrigin(window.location.protocol + "//" + window.location.host)
        .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(access_token)
        .setDeveloperKey(config.api_key)
        .setAppId(config.app_id)
        .addView(docsView)
        .setCallback((data: any) => {
          if (data.action === window.google.picker.Action.PICKED) {
            const files: PickedFile[] = (data.docs || []).map((d: any) => ({
              id: d.id,
              name: d.name,
              mimeType: d.mimeType,
              modifiedTime: d.lastEditedUtc
                ? new Date(d.lastEditedUtc).toISOString()
                : undefined,
              sizeBytes: d.sizeBytes ? String(d.sizeBytes) : undefined,
            }))
            onPicked(files)
          }
        })
        .build()

      picker.setVisible(true)
    },
    [ready, config]
  )

  return { ready, openPicker }
}
