// CRUD verbs CASL ships with, plus a few mission-lifecycle actions.
// Keeping the union small forces explicit decisions in policies; new
// verbs are added when a route actually needs one.

export type Action = 'manage' | 'create' | 'read' | 'update' | 'delete' | 'submit' | 'close';
