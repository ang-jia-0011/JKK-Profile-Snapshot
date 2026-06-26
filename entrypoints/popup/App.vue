<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { formatBytes, type ActionResult, type PopupState, type ProfileSnapshot } from '@/utils/snapshots';

type SnapshotPayload = ActionResult & {
  snapshot?: ProfileSnapshot;
};

const state = ref<PopupState | null>(null);
const loading = ref(true);
const busy = ref(false);
const message = ref('');
const snapshotName = ref('');
const activeView = ref<'site' | 'all'>('site');

const currentSnapshots = computed(() => state.value?.snapshots ?? []);
const allGroups = computed(() => state.value?.allGroups ?? []);
const currentTotalSize = computed(() =>
  currentSnapshots.value.reduce((total, snapshot) => total + snapshot.sizeBytes, 0),
);

onMounted(() => {
  refreshState();
});

async function sendMessage<T>(payload: unknown): Promise<T> {
  return browser.runtime.sendMessage(payload);
}

async function refreshState() {
  loading.value = true;
  message.value = '';

  try {
    state.value = await sendMessage<PopupState>({ type: 'GET_STATE' });
  } catch (error) {
    message.value = friendlyError(error, 'Unable to load extension state.');
  } finally {
    loading.value = false;
  }
}

async function createSnapshot() {
  if (!state.value?.tabId || busy.value) return;
  busy.value = true;
  message.value = '';

  try {
    const result = await sendMessage<ActionResult>({
      type: 'CREATE_SNAPSHOT',
      tabId: state.value.tabId,
      name: snapshotName.value,
    });
    message.value = result.message ?? '';
    if (result.ok) {
      snapshotName.value = '';
      await refreshState();
    }
  } catch (error) {
    message.value = friendlyError(error, 'Unable to create snapshot.');
  } finally {
    busy.value = false;
  }
}

async function applySnapshot(snapshotId: string, snapshotName: string) {
  if (!state.value?.tabId || busy.value) return;
  const confirmed = confirm(
    `Apply "${snapshotName}"?\n\nThis will clear this site's current cookies, localStorage, and sessionStorage, then reload the tab.`,
  );
  if (!confirmed) return;

  await runAction({
    type: 'APPLY_SNAPSHOT',
    tabId: state.value.tabId,
    snapshotId,
  });
}

async function deleteSnapshot(snapshotId: string, snapshotName: string) {
  if (busy.value) return;
  const confirmed = confirm(
    `Delete "${snapshotName}"?\n\nThis only removes the saved snapshot. It will not change the current site state.`,
  );
  if (!confirmed) return;

  await runAction({ type: 'DELETE_SNAPSHOT', snapshotId });
}

async function clearCurrentSite() {
  if (!state.value?.tabId || busy.value) return;
  const confirmed = confirm(
    `Clear all browser state for ${state.value.origin}?\n\nThis removes this site's cookies, localStorage, sessionStorage, IndexedDB, Cache Storage, and Service Worker registrations where supported. Saved snapshots are not deleted.`,
  );
  if (!confirmed) return;

  await runAction({ type: 'CLEAR_ORIGIN', tabId: state.value.tabId });
}

async function deleteAllSnapshots() {
  if (busy.value) return;
  const confirmed = confirm(
    'Delete every saved Profile Snapshot?\n\nThis does not clear any website browser state, but it cannot be undone.',
  );
  if (!confirmed) return;

  await runAction({ type: 'DELETE_ALL_SNAPSHOTS' });
}

async function exportSnapshot(snapshotId: string) {
  const confirmed = confirm(
    'Export this snapshot?\n\nThe file may contain session cookies, access tokens, client secrets, or other login credentials. Do not share it.',
  );
  if (!confirmed) return;

  try {
    const result = await sendMessage<SnapshotPayload>({ type: 'GET_SNAPSHOT', snapshotId });
    if (!result.ok || !result.snapshot) {
      message.value = result.message ?? 'Snapshot not found.';
      return;
    }

    const blob = new Blob([JSON.stringify(result.snapshot, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${result.snapshot.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    message.value = 'Snapshot exported.';
  } catch (error) {
    message.value = friendlyError(error, 'Unable to export snapshot.');
  }
}

async function runAction(payload: unknown) {
  busy.value = true;
  message.value = '';

  try {
    const result = await sendMessage<ActionResult>(payload);
    message.value = result.message ?? '';
    await refreshState();
  } catch (error) {
    message.value = friendlyError(error, 'Action failed.');
  } finally {
    busy.value = false;
  }
}

function friendlyError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
</script>

<template>
  <main class="popup-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Profile Snapshot</p>
        <h1>{{ state?.origin ?? 'Unsupported page' }}</h1>
      </div>
      <button class="icon-button" :disabled="loading || busy" title="Refresh" @click="refreshState">
        ↻
      </button>
    </header>

    <section class="warning">
      Snapshots can contain login cookies, access tokens, client secrets, and other sensitive
      session data. They stay in local extension storage.
    </section>

    <p v-if="message" class="message">{{ message }}</p>

    <section v-if="loading" class="empty-state">Loading snapshots...</section>

    <template v-else>
      <section v-if="!state?.supported" class="empty-state">
        <strong>{{ state?.error ?? 'This page cannot be snapshotted.' }}</strong>
        <span>Open a regular http or https page and try again.</span>
      </section>

      <template v-else>
        <div class="summary-grid">
          <div>
            <span>Current site</span>
            <strong>{{ currentSnapshots.length }}</strong>
          </div>
          <div>
            <span>Site storage</span>
            <strong>{{ formatBytes(currentTotalSize) }}</strong>
          </div>
          <div>
            <span>All storage</span>
            <strong>{{ formatBytes(state.totalSizeBytes) }}</strong>
          </div>
        </div>

        <section class="create-panel">
          <label for="snapshot-name">New snapshot name</label>
          <div class="create-row">
            <input
              id="snapshot-name"
              v-model="snapshotName"
              :disabled="busy"
              placeholder="Optional, e.g. admin user - dev"
              @keyup.enter="createSnapshot"
            />
            <button :disabled="busy" @click="createSnapshot">Create</button>
          </div>
        </section>

        <div class="segmented">
          <button :class="{ active: activeView === 'site' }" @click="activeView = 'site'">
            Current site
          </button>
          <button :class="{ active: activeView === 'all' }" @click="activeView = 'all'">
            All snapshots
          </button>
        </div>

        <section v-if="activeView === 'site'" class="snapshot-list">
          <div class="section-title">
            <h2>Saved for this site</h2>
            <button class="danger ghost" :disabled="busy" @click="clearCurrentSite">
              Clear site
            </button>
          </div>

          <p v-if="currentSnapshots.length === 0" class="empty-state">
            No snapshots saved for this origin yet.
          </p>

          <article v-for="snapshot in currentSnapshots" :key="snapshot.id" class="snapshot-card">
            <div class="snapshot-main">
              <h3>{{ snapshot.name }}</h3>
              <p>{{ formatDate(snapshot.createdAt) }} · {{ formatBytes(snapshot.sizeBytes) }}</p>
              <div class="chips">
                <span v-for="type in snapshot.storageTypes" :key="type">{{ type }}</span>
              </div>
            </div>
            <div class="snapshot-actions">
              <button :disabled="busy" @click="applySnapshot(snapshot.id, snapshot.name)">
                Apply
              </button>
              <button class="ghost" :disabled="busy" @click="exportSnapshot(snapshot.id)">
                Export
              </button>
              <button
                class="danger ghost"
                :disabled="busy"
                @click="deleteSnapshot(snapshot.id, snapshot.name)"
              >
                Delete
              </button>
            </div>
          </article>
        </section>

        <section v-else class="snapshot-list">
          <div class="section-title">
            <h2>All saved snapshots</h2>
            <button class="danger ghost" :disabled="busy || state.totalSizeBytes === 0" @click="deleteAllSnapshots">
              Delete all
            </button>
          </div>

          <p v-if="allGroups.length === 0" class="empty-state">No snapshots saved yet.</p>

          <div v-for="group in allGroups" :key="group.origin" class="origin-group">
            <div class="origin-heading">
              <strong>{{ group.origin }}</strong>
              <span>{{ group.snapshots.length }} · {{ formatBytes(group.totalSizeBytes) }}</span>
            </div>
            <article v-for="snapshot in group.snapshots" :key="snapshot.id" class="compact-row">
              <div>
                <strong>{{ snapshot.name }}</strong>
                <span>{{ formatDate(snapshot.createdAt) }} · {{ formatBytes(snapshot.sizeBytes) }}</span>
              </div>
              <div class="row-actions">
                <button class="ghost" :disabled="busy" @click="exportSnapshot(snapshot.id)">
                  Export
                </button>
                <button
                  class="danger ghost"
                  :disabled="busy"
                  @click="deleteSnapshot(snapshot.id, snapshot.name)"
                >
                  Delete
                </button>
              </div>
            </article>
          </div>
        </section>

        <footer class="storage-note">
          Included now: cookies, localStorage, sessionStorage. Not saved in snapshots yet:
          {{ state.unsupportedStorageTypes.join(', ') }}.
        </footer>
      </template>
    </template>
  </main>
</template>
