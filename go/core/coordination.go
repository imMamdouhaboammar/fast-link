package core

import "sync"

type ClickAction string

const (
	ClickActionSuppress           ClickAction = "suppress"
	ClickActionPassThroughNative ClickAction = "pass_through_native"
	ClickActionAlreadySuppressed  ClickAction = "already_suppressed"
)

type CoordinationState struct {
	mu                     sync.RWMutex
	anchorOwners           map[string]int
	pendingClicks          map[string]string
	suppressedEventIDs     map[string]struct{}
	handledPointerdownIDs  map[string]struct{}
}

func NewCoordinationState() *CoordinationState {
	return &CoordinationState{
		anchorOwners:          make(map[string]int),
		pendingClicks:         make(map[string]string),
		suppressedEventIDs:    make(map[string]struct{}),
		handledPointerdownIDs: make(map[string]struct{}),
	}
}

func (s *CoordinationState) RegisterAnchor(anchorID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.anchorOwners[anchorID]++
}

func (s *CoordinationState) UnregisterAnchor(anchorID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if count, ok := s.anchorOwners[anchorID]; ok {
		if count <= 1 {
			delete(s.anchorOwners, anchorID)
		} else {
			s.anchorOwners[anchorID]--
		}
	}
	delete(s.pendingClicks, anchorID)
}

func (s *CoordinationState) HasAnchorOwner(anchorID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, exists := s.anchorOwners[anchorID]
	return exists
}

func (s *CoordinationState) MarkPointerDownHandled(eventID, anchorID, controllerID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handledPointerdownIDs[eventID] = struct{}{}
	s.pendingClicks[anchorID] = controllerID
}

func (s *CoordinationState) IsPointerDownHandled(eventID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, exists := s.handledPointerdownIDs[eventID]
	return exists
}

func (s *CoordinationState) ConsumeClick(eventID, anchorID string, detail int) ClickAction {
	if detail == 0 {
		return ClickActionPassThroughNative
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.suppressedEventIDs[eventID]; ok {
		return ClickActionAlreadySuppressed
	}

	if _, ok := s.pendingClicks[anchorID]; ok {
		delete(s.pendingClicks, anchorID)
		s.suppressedEventIDs[eventID] = struct{}{}
		return ClickActionSuppress
	}

	return ClickActionPassThroughNative
}
