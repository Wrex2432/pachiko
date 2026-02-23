using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class GameLogic : MonoBehaviour
{
    public enum GoalAxis
    {
        X,
        Y,
        Z
    }

    [Header("References")]
    [SerializeField] private PlayerSpawner spawner;
    [SerializeField] private Transform goalMark;

    [Header("Win Detection")]
    [Tooltip("Which axis should be compared to goalMark to determine a win.")]
    [SerializeField] private GoalAxis goalAxis = GoalAxis.Z;

    [Tooltip("Optional: require player to be within this distance of the goal mark on the other axes too (0 = ignore).")]
    [SerializeField] private float lateralTolerance = 0f;

    [Header("Collision Rules (GLOBAL)")]
    [Tooltip("If true, balls collide with each other during lobby/join.")]
    [SerializeField] private bool enableBallToBallCollisionInLobby = false;

    [Tooltip("If true, balls collide with each other during active gameplay.")]
    [SerializeField] private bool enableBallToBallCollisionInActive = false;

    [Tooltip("Optional debug hotkey to toggle ball-to-ball collision at runtime.")]
    [SerializeField] private bool enableDebugToggleKey = false;

    [Tooltip("Key for debug toggle (legacy input). If you're Input System only, we can swap this later.")]
    [SerializeField] private KeyCode debugToggleKey = KeyCode.C;

    private BackendConnector backend;
    private bool active;
    private bool gameOverSent;

    private readonly Dictionary<string, PlayerLogic> playersByUid = new();

    public void Configure(Initializer.ControlConfig cfg, BackendConnector connector, string code)
    {
        backend = connector;

        if (spawner == null) spawner = GetComponent<PlayerSpawner>();

        // Avoid double-subscribing if Configure gets called again
        backend.OnPlayerChanged -= HandlePlayerChanged;
        backend.OnGameResult -= HandleGameResult;

        backend.OnPlayerChanged += HandlePlayerChanged;
        backend.OnGameResult += HandleGameResult;

        active = false;
        gameOverSent = false;

        // Apply lobby collision setting immediately
        PlayerLogic.SetGlobalBallToBallCollisionEnabled(enableBallToBallCollisionInLobby);
    }

    private void OnDestroy()
    {
        if (backend != null)
        {
            backend.OnPlayerChanged -= HandlePlayerChanged;
            backend.OnGameResult -= HandleGameResult;
        }
    }

    public void BeginGameplay()
    {
        active = true;
        gameOverSent = false;

        // Apply active collision setting
        PlayerLogic.SetGlobalBallToBallCollisionEnabled(enableBallToBallCollisionInActive);
    }

    public void StopGameplay()
    {
        active = false;

        // When not active, return to lobby rule (safe default)
        PlayerLogic.SetGlobalBallToBallCollisionEnabled(enableBallToBallCollisionInLobby);
    }

    private void HandlePlayerChanged(BackendConnector.FacechinkoPlayerMsg msg)
    {
        if (spawner == null || msg?.player == null) return;
        if (string.IsNullOrWhiteSpace(msg.player.uid)) return;

        var logic = spawner.SpawnOrUpdate(msg.player.uid, msg.player.name, msg.player.teamIndex);
        if (logic != null)
        {
            playersByUid[msg.player.uid] = logic;
        }

        // Ensure newly spawned balls obey current global rule immediately
        // (PlayerLogic applies on enable, but this guarantees it if spawn timing is weird)
        PlayerLogic.SetGlobalBallToBallCollisionEnabled(active
            ? enableBallToBallCollisionInActive
            : enableBallToBallCollisionInLobby);
    }

    private void Update()
    {
        if (enableDebugToggleKey && Input.GetKeyDown(debugToggleKey))
        {
            PlayerLogic.ToggleGlobalBallToBallCollision();
            Debug.Log($"[Facechinko] Ball-to-ball collision enabled: {PlayerLogic.GlobalBallToBallCollisionEnabled}");
        }

        if (!active || gameOverSent || goalMark == null || backend == null) return;
        if (playersByUid.Count == 0) return;

        // Defensive: avoid collection modified while iterating if player updates come in this frame
        var snapshot = playersByUid.Values.Where(v => v != null).ToArray();
        if (snapshot.Length == 0) return;

        for (int i = 0; i < snapshot.Length; i++)
        {
            var p = snapshot[i];
            if (p == null) continue;

            if (HasReachedGoal(p.transform.position))
            {
                active = false;
                gameOverSent = true;

                // Backend expects winningTeamIndex (0-13) + MVP uid
                backend.SendGameOver(p.TeamIndex, p.UID);

                // After win, revert to lobby collision setting (optional, but consistent)
                PlayerLogic.SetGlobalBallToBallCollisionEnabled(enableBallToBallCollisionInLobby);
                return;
            }
        }
    }

    private bool HasReachedGoal(Vector3 playerPos)
    {
        var goalPos = goalMark.position;

        float pMain, gMain;
        float pA, gA, pB, gB;

        switch (goalAxis)
        {
            case GoalAxis.X:
                pMain = playerPos.x; gMain = goalPos.x;
                pA = playerPos.y; gA = goalPos.y;
                pB = playerPos.z; gB = goalPos.z;
                break;

            case GoalAxis.Y:
                pMain = playerPos.y; gMain = goalPos.y;
                pA = playerPos.x; gA = goalPos.x;
                pB = playerPos.z; gB = goalPos.z;
                break;

            default: // Z
                pMain = playerPos.z; gMain = goalPos.z;
                pA = playerPos.x; gA = goalPos.x;
                pB = playerPos.y; gB = goalPos.y;
                break;
        }

        // Main axis reach check (player has passed/arrived at goal line)
        if (pMain < gMain) return false;

        // Optional lateral tolerance check
        if (lateralTolerance > 0f)
        {
            if (Mathf.Abs(pA - gA) > lateralTolerance) return false;
            if (Mathf.Abs(pB - gB) > lateralTolerance) return false;
        }

        return true;
    }

    private void HandleGameResult(BackendConnector.FacechinkoGameResultMsg msg)
    {
        // Once backend confirms result, ensure local sim stops
        active = false;
        gameOverSent = true;

        // Return to lobby collision mode
        PlayerLogic.SetGlobalBallToBallCollisionEnabled(enableBallToBallCollisionInLobby);
    }
}