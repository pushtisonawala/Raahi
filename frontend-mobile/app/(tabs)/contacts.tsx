// Ported from the web app's app/contacts/page.tsx. Same useContacts-backed
// CRUD flow; the web app's slide-up drawer becomes a bottom-sheet-style RN
// Modal with the same add/edit form fields.
import { useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { AlertCircle, Edit2, Plus, RefreshCw, Trash2, X } from 'lucide-react-native'
import { useContacts } from '@/lib/hooks'
import type { Contact } from '@/lib/types'
import { colors } from '@/lib/theme'

const emptyForm = { name: '', phone: '', email: '', relationship: '' }

export default function ContactsScreen() {
  const { contacts, addContact, updateContact, deleteContact, loading, error, refresh } = useContacts()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleOpen = (contact?: Contact) => {
    if (contact) {
      setFormData({
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        relationship: contact.relationship,
      })
      setEditingId(contact.id)
    } else {
      setFormData(emptyForm)
      setEditingId(null)
    }
    setIsModalOpen(true)
  }

  const handleClose = () => {
    setIsModalOpen(false)
    setEditingId(null)
    setFormData(emptyForm)
  }

  const handleSubmit = async () => {
    if (!formData.name || !formData.phone || !formData.email) return

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
    <View style={styles.flex}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Trusted contacts</Text>
          <Text style={styles.subtitle}>People who care about your safety</Text>
        </View>
        <Pressable onPress={() => handleOpen()} disabled={loading} style={styles.addButton}>
          <Plus size={20} color={colors.inkIndigo} />
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>

      {error && (
        <View style={styles.errorRow}>
          <AlertCircle size={20} color={colors.alertCoral} />
          <Text style={styles.errorRowText}>{error}</Text>
          <Pressable onPress={() => void refresh()} hitSlop={8}>
            <RefreshCw size={18} color={colors.alertCoral} />
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={styles.centeredBox}>
          <ActivityIndicator color={colors.beaconAmber} size="large" />
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <View style={styles.emptyIconCircle}>
                <View style={styles.emptyIconDot} />
              </View>
              <Text style={styles.emptyTitle}>No trusted contacts yet</Text>
              <Text style={[styles.mutedText, styles.emptyDescription]}>
                Add people you trust. They&apos;ll be notified if you need help.
              </Text>
              <Pressable onPress={() => handleOpen()} style={styles.addButton}>
                <Plus size={20} color={colors.inkIndigo} />
                <Text style={styles.addButtonText}>Add first contact</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item: contact }) => (
            <View style={styles.contactCard}>
              <View style={styles.contactCardHeader}>
                <View style={styles.contactAvatar}>
                  <View style={styles.contactAvatarDot} />
                </View>
                <View style={styles.contactActions}>
                  <Pressable
                    onPress={() => handleOpen(contact)}
                    style={styles.iconButton}
                    accessibilityLabel="Edit contact"
                  >
                    <Edit2 size={16} color={colors.foreground} />
                  </Pressable>
                  <Pressable
                    onPress={() => void handleDelete(contact.id)}
                    disabled={deletingId === contact.id}
                    style={styles.iconButton}
                    accessibilityLabel="Delete contact"
                  >
                    {deletingId === contact.id ? (
                      <ActivityIndicator size="small" color={colors.alertCoral} />
                    ) : (
                      <Trash2 size={16} color={colors.alertCoral} />
                    )}
                  </Pressable>
                </View>
              </View>
              <Text style={styles.contactName}>{contact.name}</Text>
              <Text style={styles.mutedText}>{contact.relationship}</Text>
              <Text style={styles.contactPhone}>{contact.phone}</Text>
              <Text style={styles.contactEmail}>{contact.email}</Text>
            </View>
          )}
        />
      )}

      <Modal visible={isModalOpen} animationType="slide" transparent onRequestClose={handleClose}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId ? 'Edit contact' : 'Add contact'}</Text>
              <Pressable onPress={handleClose} style={styles.iconButton} accessibilityLabel="Close">
                <X size={20} color={colors.foreground} />
              </Pressable>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                value={formData.name}
                onChangeText={(text) => setFormData({ ...formData, name: text })}
                placeholder="e.g., Alex Chen"
                placeholderTextColor={colors.mutedForeground}
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Phone</Text>
              <TextInput
                value={formData.phone}
                onChangeText={(text) => setFormData({ ...formData, phone: text })}
                placeholder="e.g., +1 (555) 123-4567"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                value={formData.email}
                onChangeText={(text) => setFormData({ ...formData, email: text })}
                placeholder="e.g., alex@example.com"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Relationship</Text>
              <TextInput
                value={formData.relationship}
                onChangeText={(text) => setFormData({ ...formData, relationship: text })}
                placeholder="e.g., Sister, Friend, Parent"
                placeholderTextColor={colors.mutedForeground}
                style={styles.input}
              />
            </View>

            <View style={styles.modalActions}>
              <Pressable onPress={handleClose} disabled={saving} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleSubmit()}
                disabled={saving}
                style={styles.saveButton}
              >
                <Text style={styles.saveButtonText}>
                  {saving ? 'Saving...' : editingId ? 'Update' : 'Add'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 16,
  },
  title: { fontSize: 26, fontWeight: '700', color: colors.foreground },
  subtitle: { fontSize: 14, color: colors.mutedForeground, marginTop: 4 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.beaconAmber,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  addButtonText: { color: colors.inkIndigo, fontWeight: '700', fontSize: 14 },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 75, 92, 0.3)',
    backgroundColor: 'rgba(255, 75, 92, 0.1)',
    borderRadius: 12,
    padding: 16,
  },
  errorRowText: { flex: 1, fontSize: 14, color: colors.foreground },
  centeredBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 182, 72, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyIconDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.beaconAmber },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.foreground, marginBottom: 8 },
  emptyDescription: { textAlign: 'center', marginBottom: 20 },
  contactCard: {
    padding: 20,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  contactAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 182, 72, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactAvatarDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.beaconAmber },
  contactActions: { flexDirection: 'row', gap: 8 },
  iconButton: { padding: 8, borderRadius: 8 },
  contactName: { fontSize: 17, fontWeight: '600', color: colors.foreground, marginBottom: 4 },
  mutedText: { fontSize: 13, color: colors.mutedForeground },
  contactPhone: {
    fontSize: 12,
    color: colors.mutedForeground,
    backgroundColor: 'rgba(85, 107, 146, 0.08)',
    padding: 8,
    borderRadius: 6,
    marginTop: 12,
    overflow: 'hidden',
  },
  contactEmail: { fontSize: 12, color: colors.mutedForeground, marginTop: 8 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 16,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 22, fontWeight: '700', color: colors.foreground },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '500', color: colors.foreground },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.foreground,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: { fontWeight: '700', color: colors.foreground },
  saveButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.beaconAmber,
  },
  saveButtonText: { fontWeight: '700', color: colors.inkIndigo },
})
