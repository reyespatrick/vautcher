import { ref } from 'vue'

// Moderator-only "View as" preview mode.
// When `asOwner` is true the console hides moderator-only UI (the
// approval tab) so the moderator previews the plain owner experience.
// Not persisted — a reload restores the normal moderator view.
const asOwner = ref(false)

export function useViewAs() {
  return { asOwner }
}
