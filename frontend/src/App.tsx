import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DriveBrowser } from "@/components/DriveBrowser"
import { Workspace } from "@/components/Workspace"
import { AskPanel } from "@/components/AskPanel"
import { UnsupportedFiles } from "@/components/UnsupportedFiles"

export default function App() {
  const [connected, setConnected] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set())
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  useEffect(() => {
    fetch("http://localhost:8000/api/auth/status")
      .then((r) => r.json())
      .then((d) => {
        setConnected(d.connected)
        setEmail(d.email ?? null)
      })
  }, [])

  const refreshPickedIds = useCallback(async () => {
    const r = await fetch("http://localhost:8000/api/drive/picked")
    const d = await r.json()
    setPickedIds(new Set((d.files ?? []).map((f: any) => f.file_id)))
    setRefreshTrigger((t) => t + 1)
  }, [])

  useEffect(() => {
    if (connected) refreshPickedIds()
  }, [connected, refreshPickedIds])

  const connect = async () => {
    const r = await fetch("http://localhost:8000/api/auth/google/start")
    const { auth_url } = await r.json()
    window.location.href = auth_url
  }

  const addFiles = async (files: any[]) => {
    const payload = files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      sizeBytes: f.size,
      folderId: f.folder_id || "",
      folderPath: f.folder_path || "",
    }))
    await fetch("http://localhost:8000/api/drive/picked", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: payload }),
    })
    refreshPickedIds()
  }

  const removeFile = async (file_id: string) => {
    await fetch(
      `http://localhost:8000/api/drive/picked?file_id=${encodeURIComponent(file_id)}`,
      { method: "DELETE" }
    )
    refreshPickedIds()
  }

  const clearAll = async () => {
    await fetch("http://localhost:8000/api/drive/picked", { method: "DELETE" })
    refreshPickedIds()
  }

  return (
    <div className="container mx-auto max-w-7xl p-6 space-y-6">
      <header className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-semibold">Gemma Drive</h1>
          <p className="text-sm text-muted-foreground">
            Local AI for your Google Drive — files never leave your laptop
          </p>
        </div>
        {email && (
          <div className="text-sm text-muted-foreground">
            Connected as <span className="font-medium">{email}</span>
          </div>
        )}
      </header>

      {!connected ? (
  <Card>
    <CardHeader><CardTitle>Connect</CardTitle></CardHeader>
    <CardContent>
      <Button onClick={connect}>Connect Google Drive</Button>
    </CardContent>
  </Card>
) : (
  <>
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <Card className="lg:col-span-4">
        <CardHeader><CardTitle>Browse Drive</CardTitle></CardHeader>
        <CardContent>
          <DriveBrowser onAddFiles={addFiles} pickedIds={pickedIds} />
        </CardContent>
      </Card>

      <Card className="lg:col-span-5">
        <CardHeader><CardTitle>Workspace</CardTitle></CardHeader>
        <CardContent>
          <Workspace
            refreshTrigger={refreshTrigger}
            onRemoveFile={removeFile}
            onClearAll={clearAll}
          />
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader><CardTitle>Ask Gemma</CardTitle></CardHeader>
        <CardContent>
          <AskPanel />
        </CardContent>
      </Card>
    </div>
    <UnsupportedFiles refreshTrigger={refreshTrigger} />
  </>
)}
    </div>
  )
}
