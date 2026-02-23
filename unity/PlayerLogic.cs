using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class PlayerLogic : MonoBehaviour
{
    [Header("Runtime Data")]
    [SerializeField] private string uid;
    [SerializeField] private string playerName;
    [SerializeField] private int teamIndex;

    [Header("References")]
    [SerializeField] private Renderer ballRenderer;
    [SerializeField] private Text nameTopText;
    [SerializeField] private Text teamBottomText;

    // ==== GLOBAL COLLISION TOGGLE ====
    // If true: balls collide with each other
    // If false: balls ignore each other
    public static bool GlobalBallToBallCollisionEnabled { get; private set; } = false;

    // Track all active ball colliders (supports 1 collider per ball, which is typical)
    private static readonly List<Collider> AllBallColliders = new();

    private Collider myCollider;
    private MaterialPropertyBlock mpb;

    private static readonly Color[] TeamColors = new Color[]
    {
        new(0.95f,0.26f,0.21f),  // 1
        new(0.91f,0.12f,0.39f),  // 2
        new(0.61f,0.15f,0.69f),  // 3
        new(0.40f,0.23f,0.72f),  // 4
        new(0.25f,0.32f,0.71f),  // 5
        new(0.13f,0.59f,0.95f),  // 6
        new(0.01f,0.66f,0.96f),  // 7
        new(0.00f,0.74f,0.83f),  // 8
        new(0.00f,0.59f,0.53f),  // 9
        new(0.30f,0.69f,0.31f),  // 10
        new(0.55f,0.76f,0.29f),  // 11
        new(1.00f,0.60f,0.00f),  // 12
        new(1.00f,0.34f,0.13f),  // 13
        new(0.47f,0.33f,0.28f)   // 14
    };

    public string UID => uid;
    public int TeamIndex => teamIndex;

    private void Awake()
    {
        if (ballRenderer == null)
            ballRenderer = GetComponentInChildren<Renderer>();

        myCollider = GetComponentInChildren<Collider>();
        mpb = new MaterialPropertyBlock();
    }

    private void OnEnable()
    {
        RegisterCollider();
        ApplyCollisionRuleForThisCollider();
        RefreshVisuals();
    }

    private void OnDisable()
    {
        UnregisterCollider();
    }

    private void OnDestroy()
    {
        UnregisterCollider();
    }

    public void Init(string newUid, string newName, int newTeamIndex)
    {
        uid = newUid;
        playerName = newName;
        teamIndex = Mathf.Clamp(newTeamIndex, 0, TeamColors.Length - 1);

        RefreshVisuals();
        // Collision rule is global; no need to change per player on Init.
    }

    private void RefreshVisuals()
    {
        if (ballRenderer != null)
        {
            ballRenderer.GetPropertyBlock(mpb);
            mpb.SetColor("_Color", TeamColors[teamIndex]);
            ballRenderer.SetPropertyBlock(mpb);
        }

        if (nameTopText != null)
            nameTopText.text = string.IsNullOrEmpty(playerName) ? "" : playerName;

        if (teamBottomText != null)
            teamBottomText.text = $"TEAM {teamIndex + 1}";
    }

    private void RegisterCollider()
    {
        if (myCollider == null) return;
        if (!AllBallColliders.Contains(myCollider))
            AllBallColliders.Add(myCollider);
    }

    private void UnregisterCollider()
    {
        if (myCollider == null) return;
        AllBallColliders.Remove(myCollider);
    }

    /// <summary>
    /// Applies the current global collision rule between THIS collider and all other ball colliders.
    /// Called when a ball spawns/enables.
    /// </summary>
    private void ApplyCollisionRuleForThisCollider()
    {
        if (myCollider == null) return;

        // If collisions are enabled: do NOT ignore
        // If collisions are disabled: ignore
        bool shouldIgnore = !GlobalBallToBallCollisionEnabled;

        for (int i = 0; i < AllBallColliders.Count; i++)
        {
            var other = AllBallColliders[i];
            if (other == null || other == myCollider) continue;

            Physics.IgnoreCollision(myCollider, other, shouldIgnore);
        }
    }

    /// <summary>
    /// GLOBAL: Enable/disable ball-to-ball collisions for ALL balls.
    /// Call this from GameLogic / Initializer / a debug key.
    /// </summary>
    public static void SetGlobalBallToBallCollisionEnabled(bool enabled)
    {
        GlobalBallToBallCollisionEnabled = enabled;

        bool shouldIgnore = !GlobalBallToBallCollisionEnabled;

        // Re-apply rule across all pairs (56 players is totally fine).
        for (int i = 0; i < AllBallColliders.Count; i++)
        {
            var a = AllBallColliders[i];
            if (a == null) continue;

            for (int j = i + 1; j < AllBallColliders.Count; j++)
            {
                var b = AllBallColliders[j];
                if (b == null) continue;

                Physics.IgnoreCollision(a, b, shouldIgnore);
            }
        }
    }

    /// <summary>
    /// Convenience toggle.
    /// </summary>
    public static void ToggleGlobalBallToBallCollision()
    {
        SetGlobalBallToBallCollisionEnabled(!GlobalBallToBallCollisionEnabled);
    }
}