import os
import pytest
import tempfile
import shutil

def test_ensure_unique_path():
    import app.utils.filesystem as fs
    
    tmpdir = tempfile.mkdtemp()
    try:
        path = os.path.join(tmpdir, "test.txt")
        # Case 1: Path does not exist
        assert fs._ensure_unique_path(path) == path
        
        # Case 2: Path exists
        with open(path, "w") as f:
            f.write("hello")
        
        unique_path = fs._ensure_unique_path(path)
        assert unique_path == os.path.join(tmpdir, "test (1).txt")
        
        # Case 3: Multiple duplicates
        with open(unique_path, "w") as f:
            f.write("hello 1")
        
        unique_path_2 = fs._ensure_unique_path(path)
        assert unique_path_2 == os.path.join(tmpdir, "test (2).txt")
        
    finally:
        shutil.rmtree(tmpdir)

def test_ensure_unique_path_limit():
    import app.utils.filesystem as fs
    import os
    
    # Mock os.path.exists to always return True
    def mock_exists(p):
        return True
        
    import app.utils.filesystem
    original_exists = os.path.exists
    os.path.exists = mock_exists
    try:
        with pytest.raises(RuntimeError, match="Too many duplicate filenames"):
            fs._ensure_unique_path("anything.txt")
    finally:
        os.path.exists = original_exists
