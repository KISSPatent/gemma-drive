import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type UnsupportedFile = {
  file_id: string
  name: string
  mime_type: string
  folder_path: string
  modified_time: string | null
  size_bytes: number | null
  owner?: string
  owner_email?: string
}

type Props = { refreshTrigger: number }

export function UnsupportedFiles({ refreshTrigger }: Props) {
  const [files, setFiles] = useState<UnsupportedFile[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const r = await fetch("http://localhost:8000/api/chat/workspace/unsupported")
    const d = await r.json()
    setFiles(d.files ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh, refreshTrigger])

  if (files.length === 0 && !loading) return null

  const friendlyMime = (m: string) =>
    m.replace("application/vnd.openxmlformats-officedocument.", "")
      .replace("application/vnd.google-apps.", "google-")
      .replace("application/", "")

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Unsupported files</span>
          <Badge variant="secondary">{files.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          These files are in your workspace but the extraction pipeline doesn't handle their format yet.
          Audio, video, and a few legacy formats are on the v1.1 roadmap.
        </p>
        {!expanded ? (
          <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
            Show {files.length} file{files.length === 1 ? "" : "s"}
          </Button>
        ) : (
          <div className="space-y-2">
            <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Hide
            </Button>
            <ul className="divide-y text-sm">
              {files.map((f) => (
                <li key={f.file_id} className="py-2">
                  <div className="font-medium truncate">{f.name}</div>
                  <div className="text-xs text-muted-foreground space-x-2 flex flex-wrap gap-1 mt-0.5">
                    <span>📁 {f.folder_path}</span>
                    <span>·</span>
                    <span className="font-mono">{friendlyMime(f.mime_type)}</span>
                    {f.modified_time && (
                      <>
                        <span>·</span>
                        <span>modified {new Date(f.modified_time).toLocaleDateString()}</span>
                      </>
                    )}
                    {f.owner && (
                      <>
                        <span>·</span>
                        <span>owner: {f.owner}</span>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
