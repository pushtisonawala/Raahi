'use client'

import { useState } from 'react'
import { Header } from '@/components/header'
import { useContacts } from '@/lib/hooks'
import { AlertCircle, Edit2, LoaderCircle, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import type { Contact } from '@/lib/types'

export default function ContactsPage() {
  const { contacts, addContact, updateContact, deleteContact, loading, error, refresh } = useContacts()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ name: '', phone: '', relationship: '' })
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleOpen = (contact?: Contact) => {
    if (contact) {
      setFormData({ name: contact.name, phone: contact.phone, relationship: contact.relationship })
      setEditingId(contact.id)
    } else {
      setFormData({ name: '', phone: '', relationship: '' })
      setEditingId(null)
    }
    setIsDrawerOpen(true)
  }

  const handleClose = () => {
    setIsDrawerOpen(false)
    setEditingId(null)
    setFormData({ name: '', phone: '', relationship: '' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name || !formData.phone) return

    setSaving(true)
    try {
      if (editingId) await updateContact(editingId, formData)
      else await addContact(formData)
      handleClose()
    } catch {
      // The hook exposes the server error next to the form.
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await deleteContact(id)
    } catch {
      // The hook exposes the server error above the contact list.
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Trusted contacts</h1>
            <p className="text-muted-foreground">People who care about your safety</p>
          </div>
          <button
            onClick={() => handleOpen()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-beacon-amber text-ink-indigo font-semibold rounded-lg hover:bg-amber-500 transition-colors"
          >
            <Plus size={20} />
            Add contact
          </button>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-alert-coral/30 bg-alert-coral/10 p-4 text-sm" role="alert">
            <AlertCircle className="shrink-0 text-alert-coral" size={20} />
            <p className="flex-1 text-foreground">{error}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="p-2 text-alert-coral hover:bg-alert-coral/10 rounded-md"
              aria-label="Retry loading contacts"
              title="Retry"
            >
              <RefreshCw size={18} />
            </button>
          </div>
        )}

        {/* Contacts Grid */}
        {loading ? (
          <div className="flex min-h-48 items-center justify-center" role="status">
            <LoaderCircle className="animate-spin text-beacon-amber" size={28} />
            <span className="sr-only">Loading contacts</span>
          </div>
        ) : contacts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="p-6 bg-card rounded-lg border border-border hover:border-beacon-amber/50 transition-colors group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-full bg-beacon-amber/20 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-beacon-amber" />
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleOpen(contact)}
                      className="p-2 hover:bg-muted rounded-md transition-colors"
                      aria-label="Edit contact"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => void handleDelete(contact.id)}
                      disabled={deletingId === contact.id}
                      className="p-2 hover:bg-alert-coral/10 text-alert-coral rounded-md transition-colors"
                      aria-label="Delete contact"
                    >
                      {deletingId === contact.id ? <LoaderCircle className="animate-spin" size={16} /> : <Trash2 size={16} />}
                    </button>
                  </div>
                </div>
                <h3 className="font-semibold text-foreground text-lg mb-1">{contact.name}</h3>
                <p className="text-sm text-muted-foreground mb-3">{contact.relationship}</p>
                <p className="text-xs font-mono text-muted-foreground bg-muted/50 p-2 rounded">
                  {contact.phone}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-card rounded-lg border-2 border-dashed border-border">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-beacon-amber/10 mb-4">
              <div className="w-8 h-8 rounded-full bg-beacon-amber" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">No trusted contacts yet</h2>
            <p className="text-muted-foreground mb-6">
              Add people you trust. They&apos;ll be notified if you need help.
            </p>
            <button
              onClick={() => handleOpen()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-beacon-amber text-ink-indigo font-semibold rounded-lg hover:bg-amber-500 transition-colors"
            >
              <Plus size={20} />
              Add first contact
            </button>
          </div>
        )}
      </div>

      {/* Contact Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center">
          <div className="w-full sm:max-w-md bg-background rounded-t-2xl sm:rounded-lg p-6 border border-border sm:border-border">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-foreground">
                {editingId ? 'Edit contact' : 'Add contact'}
              </h2>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-muted rounded-md"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Alex Chen"
                  className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-beacon-amber"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Phone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="e.g., +1 (555) 123-4567"
                  className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-beacon-amber"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Relationship</label>
                <input
                  type="text"
                  value={formData.relationship}
                  onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}
                  placeholder="e.g., Sister, Friend, Parent"
                  className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-beacon-amber"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={saving}
                  className="flex-1 px-4 py-2 border border-border rounded-lg font-semibold hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-beacon-amber text-ink-indigo rounded-lg font-semibold hover:bg-amber-500 transition-colors"
                >
                  {saving ? 'Saving...' : editingId ? 'Update' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
