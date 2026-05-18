import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"

type DriveFile = {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  size?: string
}

type Crumb = { id: string; name: string }

const FOLDER_MIME = "application/vnd.google-apps.folder"

type Props = {
  onAddFiles: (files: DriveFile[]) => Promise<void>
  pickedIds: Set<string>
}

export function DriveBrowser({ onAddFiles, pickedIds }: Props) {
  const [folderId, setFolderId] = useState("root")
  const [files, setFiles] = useState<DriveFile[]>([])
  const [path, setPath] = useState<Crumb[]>([{ id: "root", name: "My Drive" }])
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = useCallback(async (fid: string, q: string) => {
    setLoading(true)
    const params = new URLSearchParams({ folder_id: fid })
    if (q) params.set("q", q)
    const [browseRes, pathRes] = await Promise.all([
      fetch(`http://localhost:8000/api/drive/browse?${params}`),
      fetch(`http://localhost:8000/api/drive/path?folder_id=${fid}`),
    ])
    const browseData = await browseRes.json()
    const pathData = await pathRes.json()
    setFiles(browseData.files ?? [])
    setPath(pathData.path ?? [{ id: "root", name: "My Drive" }])
    setLoading(false)
  }, [])

  useEffect(() => {
    load(folderId, search)
  }, [folderId, search, load])

  const openFolder = (id: string) => {
    setSelected(new Set())
    setSearchInput("")
    setSearch("")
    setFolderId(id)
  }

  const addFolder = async (id: string, name: string) => {
  setLoading(true)
  try {
    const r = await fetch(
      `http://localhost:8000/api/drive/folder-contents?folder_id=${id}&folder_name=${encodeURIComponent(name)}`
    )
    const d = await r.json()
    const filesInFolder = (d.files ?? []) as DriveFile[]
    if (filesInFolder.length === 0) {
      alert(`"${name}" is empty or contains only sub-folders with no files.`)
      return
    }
    if (filesInFolder.length >= 500) {
      const ok = confirm(
        `"${name}" contains 500+ files (capped). Add the first 500 to your workspace?`
      )
      if (!ok) return
    }
    await onAddFiles(filesInFolder)
  } catch (err) {
    alert(`Failed to load folder: ${err instanceof Error ? err.message : "unknown"}`)
  } finally {
    setLoading(false)
  }
}

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addSelected = async () => {
    const toAdd = files.filter((f) => selected.has(f.id) && f.mimeType !== FOLDER_MIME)
    if (toAdd.length === 0) return
    await onAddFiles(toAdd)
    setSelected(new Set())
  }

  const runSearch = () => {
    setSearch(searchInput.trim())
  }

  return (
    <div className="space-y-3">
      {/* Breadcrumbs */}
      <div className="flex items-center flex-wrap gap-1 text-sm">
        {path.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">/</span>}
            <button
              className="hover:underline text-left"
              onClick={() => openFolder(c.id)}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <Input
          placeholder="Search file names in current folder..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
        />
        <Button variant="outline" onClick={runSearch}>
          Search
        </Button>
        {search && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearchInput("")
              setSearch("")
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <Separator />

      {/* File list */}
      <div className="min-h-[300px]">
        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {search ? "No files matching your search." : "This folder is empty."}
          </p>
        ) : (
          <ul className="divide-y">
            {files.map((f) => {
              const isFolder = f.mimeType === FOLDER_MIME
              const alreadyPicked = pickedIds.has(f.id)
              return (
                <li
                  key={f.id}
                  className="py-2 flex items-center gap-3"
                >
                  {isFolder ? (
                    <div className="w-4" />
                  ) : (
                    <Checkbox
                      checked={selected.has(f.id)}
                      onCheckedChange={() => toggle(f.id)}
                      disabled={alreadyPicked}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    {isFolder ? (
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          className="font-medium hover:underline text-left truncate"
                          onClick={() => openFolder(f.id)}
                        >
                          📁 {f.name}
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            addFolder(f.id, f.name)
                          }}
                          disabled={loading}
                        >
                          + Add folder
                        </Button>
                      </div>
                    ) : (
                      <div className="font-medium truncate">
                        {f.name}
                        {alreadyPicked && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (already added)
                          </span>
                        )}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground truncate">
                      {f.mimeType.replace("application/vnd.google-apps.", "google-")}
                      {f.modifiedTime &&
                        ` · modified ${new Date(f.modifiedTime).toLocaleDateString()}`}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm">
            {selected.size} file{selected.size > 1 ? "s" : ""} selected
          </span>
          <Button onClick={addSelected}>Add to workspace</Button>
        </div>
      )}
    </div>
  )
}
