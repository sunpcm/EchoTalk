from unittest.mock import MagicMock, patch

from services.rag_service import _get_client, retrieve_materials


def test_get_client_caching():
    """Verify _get_client caching returns the same instance on repeated calls."""
    client1 = _get_client()
    client2 = _get_client()
    assert client1 is client2


@patch("services.rag_service._get_collection")
def test_retrieve_materials_empty_collection(mock_get_collection):
    """Verify retrieve_materials returns empty list when collection is empty."""
    mock_collection = MagicMock()
    mock_collection.count.return_value = 0
    mock_get_collection.return_value = mock_collection

    results = retrieve_materials(weak_skills=["grammar"], target_level="B1", top_k=3)
    assert results == []


@patch("services.rag_service._get_collection")
def test_retrieve_materials_success(mock_get_collection):
    """Verify retrieve_materials formats and returns materials correctly."""
    mock_collection = MagicMock()
    mock_collection.count.return_value = 5
    mock_collection.query.return_value = {
        "ids": [["doc1"]],
        "documents": [["Sample text"]],
        "metadatas": [
            [
                {
                    "scenario_name": "Ordering Food",
                    "difficulty_cefr": "B1",
                    "category": "Daily",
                    "primary_skill": "speaking",
                    "skill_tags": "food,ordering",
                }
            ]
        ],
        "distances": [[0.15]],
    }
    mock_get_collection.return_value = mock_collection

    materials = retrieve_materials(weak_skills=["speaking"], target_level="B1", top_k=1)

    assert len(materials) == 1
    assert materials[0].id == "doc1"
    assert materials[0].scenario_name == "Ordering Food"
    assert materials[0].difficulty_cefr == "B1"
    assert materials[0].skill_tags == ["food", "ordering"]
    assert materials[0].distance == 0.15
